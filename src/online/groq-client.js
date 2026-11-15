// Client minimal de l'API Groq (compatible OpenAI) : transcription avec
// Whisper large-v3 puis traduction du texte par un modèle de langage.
//
// La clé API est celle de l'utilisateur, fournie depuis son navigateur ;
// seul l'audio compressé (jamais la vidéo) est envoyé.

import { t } from '../i18n/index.js'
import { recordRateLimitHeaders, recordLimitFromMessage, parseRetryAfterSeconds, recordBytesSent } from './quota.js'
import { network, NETWORK_RETRY_DELAYS, clearNetworkNotice, waitWithCountdown, waitUntilOnline } from './network.js'
const API_BASE = 'https://api.groq.com/openai/v1'

export const TRANSCRIPTION_MODEL = 'whisper-large-v3'
// Modèles de traduction, du plus qualitatif au plus léger. On bascule sur
// le suivant quand le quota du premier est atteint ou qu'il n'est pas
// accessible avec la clé de l'utilisateur.
//
// Les modèles Llama ont été retirés de l'offre gratuite de Groq (août
// 2026) : les identifiants changent avec le temps. La liste réellement
// disponible est donc demandée à l'API (GET /models) et croisée avec cette
// liste de préférence ; `extra` règle le niveau de réflexion, pour ne pas
// gaspiller le quota de jetons en raisonnement inutile.
export const TRANSLATION_MODEL_PREFERENCE = [
  { id: 'openai/gpt-oss-120b', extra: { reasoning_effort: 'low' } },
  { id: 'qwen/qwen3.8-27b', extra: { reasoning_effort: 'none' } },
  { id: 'openai/gpt-oss-20b', extra: { reasoning_effort: 'low' } }
]

// Modèles de l'API qui ne sont pas des modèles de texte généralistes.
const NON_CHAT_MODEL_PATTERN = /whisper|tts|orpheus|guard|compound|embed|prompt/i
const MAX_EXTRA_MODELS = 2

export const LANGUAGE_NAMES = { fr: 'French', en: 'English' }

// Attente maximale acceptée avant de retenter après un 429 : au-delà, on
// considère le quota comme épuisé (limite par heure ou par jour).
const MAX_RETRY_WAIT_SECONDS = 60
const MAX_RATE_LIMIT_RETRIES = 3
const MAX_SERVER_ERROR_RETRIES = 2

// Délai maximal avant l'arrivée de la réponse. Sans lui, une connexion qui
// se fige sans erreur bloquerait la file indéfiniment. Un dépassement est
// traité comme une coupure réseau (nouvelle tentative avec compte à rebours).
// La transcription est large : elle envoie ~1,3 Mo sur une liaison lente.
const TIMEOUT_TRANSCRIPTION_MS = 180_000
const TIMEOUT_DEFAULT_MS = 90_000

// Seuils habituels de Whisper pour écarter les segments non fiables.
const NO_SPEECH_PROB_THRESHOLD = 0.6
const LOW_LOGPROB_THRESHOLD = -1
const COMPRESSION_RATIO_THRESHOLD = 2.4

// Budget d'un lot de lignes à traduire (équilibre qualité / nombre d'appels).
const TRANSLATION_BATCH_MAX_LINES = 25
const TRANSLATION_BATCH_MAX_CHARS = 2500

/**
 * kind : 'auth' (clé refusée), 'quota' (limite gratuite atteinte),
 * 'network' (Groq injoignable), 'model' (modèle indisponible),
 * 'invalid' (requête refusée), 'other'.
 */
export class OnlineError extends Error {
  constructor(kind, message, { retryAfterSeconds = null } = {}) {
    super(message)
    this.name = 'OnlineError'
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function sleep(seconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, seconds * 1000)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Annulé', 'AbortError'))
    }, { once: true })
  })
}

async function readErrorMessage(response) {
  try {
    const body = await response.json()
    return body?.error?.message || `Erreur ${response.status}`
  } catch {
    return `Erreur ${response.status}`
  }
}

/** Octets que la requête fait partir (corps seul : les en-têtes sont négligeables). */
function estimateBodyBytes(body) {
  if (!body) return 0
  if (typeof body === 'string') return new Blob([body]).size
  if (body instanceof FormData) {
    let total = 0
    for (const [, value] of body.entries()) total += typeof value === 'string' ? value.length : value.size
    return total
  }
  return body.size || 0
}

// Enveloppe de groqFetch : les coupures réseau sont réessayées avec des
// délais croissants (et en attendant le retour de la connexion si
// l'appareil est hors ligne), puis on abandonne en gardant la progression.
async function groqFetch(path, buildInit, options) {
  try {
    return await groqFetchOnce(path, buildInit, options)
  } finally {
    clearNetworkNotice()
  }
}

async function groqFetchOnce(path, buildInit, { apiKey, signal, modelErrors = false, timeoutMs = TIMEOUT_DEFAULT_MS }) {
  let rateLimitRetries = 0
  let serverErrorRetries = 0
  let networkRetries = 0

  while (true) {
    if (signal?.aborted) throw new DOMException('Annulé', 'AbortError')

    // Un contrôleur par tentative : il relaie l'annulation de l'utilisateur
    // et ajoute le délai maximal.
    const attempt = new AbortController()
    const relayAbort = () => attempt.abort()
    signal?.addEventListener('abort', relayAbort, { once: true })
    const timer = setTimeout(relayAbort, timeoutMs)

    let response
    try {
      const init = buildInit()
      recordBytesSent(estimateBodyBytes(init.body))
      response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) },
        signal: attempt.signal
      })
    } catch (error) {
      // Annulation voulue par l'utilisateur ; un simple délai dépassé,
      // lui, retombe dans le traitement des coupures ci-dessous.
      if (signal?.aborted) throw new DOMException('Annulé', 'AbortError')

      // Hors ligne : on attend le retour du réseau (sans compter d'essai).
      if (navigator.onLine === false) {
        network.state = 'offline'
        await waitUntilOnline(signal)
        continue
      }
      if (networkRetries >= NETWORK_RETRY_DELAYS.length) throw new OnlineError('network', t('err.network'))

      network.state = 'retrying'
      network.attempt = networkRetries + 1
      await waitWithCountdown(NETWORK_RETRY_DELAYS[networkRetries], signal)
      networkRetries++
      continue
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', relayAbort)
    }
    clearNetworkNotice()

    recordRateLimitHeaders(response.headers)
    if (response.ok) return response

    if (response.status === 401 || response.status === 403) {
      throw new OnlineError('auth', t('err.auth'))
    }

    if (response.status === 429) {
      const quotaMessage = await readErrorMessage(response.clone())
      recordLimitFromMessage(quotaMessage)
      const retryAfter = Number(response.headers.get('retry-after')) || parseRetryAfterSeconds(quotaMessage) || 0
      if (retryAfter > 0 && retryAfter <= MAX_RETRY_WAIT_SECONDS && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
        rateLimitRetries++
        await sleep(retryAfter + 0.5, signal)
        continue
      }
      throw new OnlineError('quota', t('err.quotaBase'), { retryAfterSeconds: retryAfter || null })
    }

    if (response.status >= 500 && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
      serverErrorRetries++
      await sleep(2 * serverErrorRetries, signal)
      continue
    }

    const message = await readErrorMessage(response)
    // Pour un appel de modèle, un 400/404 signifie "modèle absent, retiré
    // ou paramètre non géré" : on peut essayer le modèle suivant.
    if (modelErrors && (response.status === 400 || response.status === 404)) {
      throw new OnlineError('model', message)
    }
    throw new OnlineError(response.status >= 500 ? 'other' : 'invalid', message)
  }
}

function isReliableSegment(segment) {
  if (segment.noSpeechProb > NO_SPEECH_PROB_THRESHOLD && segment.avgLogprob < LOW_LOGPROB_THRESHOLD) return false
  if (segment.compressionRatio > COMPRESSION_RATIO_THRESHOLD) return false
  return true
}

/**
 * Transcrit un morceau audio. Les timestamps renvoyés sont relatifs au
 * début du morceau.
 *
 * @returns {{ language: string | undefined, segments: { start: number, end: number, text: string, reliable: boolean }[] }}
 */
export async function transcribeChunk(blob, { apiKey, signal, prompt, language = null }) {
  const buildInit = () => {
    const form = new FormData()
    form.append('file', blob, 'audio.mp3')
    form.append('model', TRANSCRIPTION_MODEL)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    form.append('temperature', '0')
    if (prompt) form.append('prompt', prompt.slice(-500))
    // Langue imposée une fois détectée de façon fiable : évite qu'une
    // fenêtre de musique ou de bruit la fasse basculer.
    if (language) form.append('language', language)
    return { method: 'POST', body: form }
  }

  const response = await groqFetch('/audio/transcriptions', buildInit, { apiKey, signal, timeoutMs: TIMEOUT_TRANSCRIPTION_MS })
  const data = await response.json()

  const rawSegments = Array.isArray(data.segments) && data.segments.length > 0
    ? data.segments
    : (data.text?.trim() ? [{ start: 0, end: data.duration || 0, text: data.text }] : [])

  const segments = rawSegments
    .map((s) => ({
      start: s.start,
      end: s.end,
      text: String(s.text || '').trim(),
      reliable: isReliableSegment({
        noSpeechProb: s.no_speech_prob,
        avgLogprob: s.avg_logprob,
        compressionRatio: s.compression_ratio
      })
    }))
    .filter((s) => s.text)

  return { language: data.language, segments }
}

// Noms de langue renvoyés par Whisper -> code ISO 639-1 attendu par le
// paramètre `language`. Une langue absente de cette table n'est pas imposée.
const WHISPER_LANGUAGE_CODES = {
  english: 'en', french: 'fr', spanish: 'es', german: 'de', italian: 'it', portuguese: 'pt',
  dutch: 'nl', arabic: 'ar', chinese: 'zh', japanese: 'ja', korean: 'ko', russian: 'ru',
  turkish: 'tr', polish: 'pl', ukrainian: 'uk', hindi: 'hi', swedish: 'sv', norwegian: 'no',
  danish: 'da', finnish: 'fi', greek: 'el', czech: 'cs', romanian: 'ro', hungarian: 'hu',
  hebrew: 'he', indonesian: 'id', vietnamese: 'vi', thai: 'th', urdu: 'ur', catalan: 'ca'
}

/** 'French' / 'fr' -> 'fr' ; langue inconnue -> null. */
export function toIsoLanguageCode(language) {
  if (!language) return null
  const value = String(language).trim().toLowerCase()
  if (/^[a-z]{2}$/.test(value)) return value
  return WHISPER_LANGUAGE_CODES[value] || null
}

// 'french' / 'fr' -> 'fr' ; inconnu -> null.
function normalizeLanguage(language) {
  if (!language) return null
  const value = String(language).toLowerCase()
  if (value === 'fr' || value === 'french') return 'fr'
  if (value === 'en' || value === 'english') return 'en'
  return value
}

// Faut-il traduire ? Si la langue détectée est inconnue, on laisse le
// modèle trancher : la consigne lui demande de renvoyer tel quel un
// texte déjà dans la langue cible.
export function needsTranslation(detectedLanguage, targetLanguage) {
  const detected = normalizeLanguage(detectedLanguage)
  return detected === null || detected !== targetLanguage
}

function splitIntoBatches(texts) {
  const batches = []
  let current = []
  let chars = 0
  for (const text of texts) {
    if (current.length > 0 && (current.length >= TRANSLATION_BATCH_MAX_LINES || chars + text.length > TRANSLATION_BATCH_MAX_CHARS)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(text)
    chars += text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Client de chat JSON partagé (traduction, résumé). Il garde en mémoire le
 * modèle en cours : une fois le quota du modèle principal atteint, tous les
 * appels suivants utilisent directement le modèle de repli.
 */
export function createChatClient({ apiKey, signal }) {
  let models = null
  let modelIndex = 0

  // Croise la liste de préférence avec les modèles réellement accessibles.
  // Si la liste ne peut pas être lue, on tente la liste de préférence telle
  // quelle (les erreurs "modèle indisponible" font passer au suivant).
  async function resolveModels() {
    if (models) return models
    try {
      const response = await groqFetch('/models', () => ({ method: 'GET' }), { apiKey, signal })
      const data = await response.json()
      const available = new Set((data.data || []).map((m) => m.id))
      const preferred = TRANSLATION_MODEL_PREFERENCE.filter((m) => available.has(m.id))
      const known = new Set(TRANSLATION_MODEL_PREFERENCE.map((m) => m.id))
      const extras = [...available]
        .filter((id) => !known.has(id) && !NON_CHAT_MODEL_PATTERN.test(id))
        .slice(0, MAX_EXTRA_MODELS)
        .map((id) => ({ id, extra: {} }))
      const resolved = [...preferred, ...extras]
      models = resolved.length > 0 ? resolved : TRANSLATION_MODEL_PREFERENCE
    } catch (error) {
      if (error.name === 'AbortError' || (error instanceof OnlineError && error.kind === 'auth')) throw error
      models = TRANSLATION_MODEL_PREFERENCE
    }
    return models
  }

  async function callModel({ system, user, temperature, validate }) {
    const available = await resolveModels()
    const model = available[modelIndex]

    const buildInit = () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.id,
        temperature,
        response_format: { type: 'json_object' },
        ...model.extra,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    })

    const response = await groqFetch('/chat/completions', buildInit, { apiKey, signal, modelErrors: true })
    const data = await response.json()
    const raw = String(data?.choices?.[0]?.message?.content || '')
    // Certains modèles de raisonnement laissent un bloc <think> ou des
    // balises de code autour du JSON.
    const content = raw
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/^```(?:json)?\s*|\s*```$/g, '')
      .trim()
    return validate(JSON.parse(content))
  }

  /**
   * Demande une réponse JSON. Passe au modèle suivant si le quota est
   * atteint ou si le modèle est indisponible. Une réponse mal formée
   * (JSON invalide ou refusé par `validate`) est remontée à l'appelant,
   * qui décide quoi faire (scinder le lot, réessayer...).
   */
  return async function completeJson({ system, user, temperature = 0.2, validate }) {
    while (true) {
      try {
        return await callModel({ system, user, temperature, validate })
      } catch (error) {
        if (error.name === 'AbortError') throw error
        if (error instanceof OnlineError && (error.kind === 'quota' || error.kind === 'model')) {
          const lastIndex = (models?.length || 1) - 1
          if (modelIndex < lastIndex) {
            modelIndex++
            continue
          }
          if (error.kind === 'model') {
            throw new OnlineError('nomodel', t('err.noModel', { detail: error.message }))
          }
        }
        throw error
      }
    }
  }
}

/** Crée un traducteur de sous-titres (lots de lignes, repli de modèle, découpage si réponse mal formée). */
export function createTranslator({ apiKey, targetLanguage, signal }) {
  const targetName = LANGUAGE_NAMES[targetLanguage]
  const completeJson = createChatClient({ apiKey, signal })

  async function callModel(lines) {
    const system =
      `You are a professional subtitle translator. Translate each subtitle line into ${targetName}. ` +
      'Preserve meaning, tone and register; keep each line concise and natural for on-screen reading; keep proper names unchanged. ' +
      'Never merge, split, add or drop lines. If a line is already in ' + targetName + ', return it unchanged. ' +
      `Reply only with a JSON object {"translations": [...]} holding exactly ${lines.length} strings, in the same order.`

    return completeJson({
      system,
      user: JSON.stringify({ lines }),
      validate(parsed) {
        if (!Array.isArray(parsed.translations) || parsed.translations.length !== lines.length) {
          throw new OnlineError('other', t('err.unexpectedTranslation'))
        }
        return parsed.translations.map((item, i) => (typeof item === 'string' && item.trim() ? item.trim() : lines[i]))
      }
    })
  }

  // Un lot : en cas de réponse mal formée, on scinde jusqu'à la ligne
  // seule, puis on conserve le texte d'origine plutôt que de perdre le
  // sous-titre.
  async function translateBatch(lines) {
    try {
      return await callModel(lines)
    } catch (error) {
      if (error.name === 'AbortError') throw error
      if (error instanceof OnlineError && error.kind !== 'other') throw error

      if (lines.length === 1) return lines
      const middle = Math.ceil(lines.length / 2)
      return [...(await translateBatch(lines.slice(0, middle))), ...(await translateBatch(lines.slice(middle)))]
    }
  }

  return async function translate(texts) {
    const result = []
    for (const batch of splitIntoBatches(texts)) {
      result.push(...(await translateBatch(batch)))
    }
    return result
  }
}
