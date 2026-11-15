// Pipeline en ligne : la piste audio est extraite par fenêtres, compressée
// en MP3 (l'image n'est jamais envoyée), transcrite par Whisper large-v3,
// puis traduite si la langue détectée n'est pas la langue demandée.
//
// Une fenêtre couvre STREAM_CHUNK_SECONDS + un surplus : comme en mode
// local, chaque fenêtre "possède" les segments qui COMMENCENT dans sa part
// principale, et la suivante démarre là où le dernier segment possédé se
// termine, pour ne jamais couper une phrase en deux.
//
// Aucune détection de silence préalable : Whisper large-v3 s'en charge et
// le score no_speech_prob écarte les passages non fiables.

import { t } from '../i18n/index.js'
import { recordAudioSeconds } from './quota.js'
import {
  openMediaSource,
  extractCompressedChunk
} from '../audio/audio-stream.js'
import { STREAM_CHUNK_SECONDS, STREAM_LOOKAHEAD_SECONDS } from '../audio/constants.js'
import { transcribeChunk, createTranslator, needsTranslation, toIsoLanguageCode, OnlineError } from './groq-client.js'
import { isLikelyHallucination } from '../utils/hallucination-filter.js'

// Sous cette durée (secondes), le morceau est considéré comme vide.
const MIN_CHUNK_SECONDS = 0.3
// Nombre de caractères du texte précédent transmis à Whisper pour la
// continuité (noms propres, vocabulaire).
const PROMPT_CONTEXT_CHARS = 300
// Nombre minimal de segments fiables pour considérer la langue détectée
// comme sûre et l'imposer aux fenêtres suivantes (une fenêtre de musique
// ou de bruit pourrait sinon la faire basculer).
const LANGUAGE_LOCK_MIN_SEGMENTS = 3

/**
 * @param {File} file
 * @param {{
 *   apiKey: string,
 *   targetLanguage: 'fr' | 'en',
 *   durationHint?: number,
 *   signal?: AbortSignal,
 *   startAt?: number,
 *   onWindow: (window: {
 *     startTime: number, endTime: number, horizon: number,
 *     clauses: { text: string, startTime: number, endTime: number, words: [] }[],
 *     language?: string, analyzedSeconds: number
 *   }) => void
 * }} options
 */
export async function runOnlinePipeline(file, { apiKey, targetLanguage, durationHint, signal, startAt = 0, onWindow }) {
  const source = await openMediaSource(file, signal)
  const translate = createTranslator({ apiKey, targetLanguage, signal })

  try {
    const windowLength = STREAM_CHUNK_SECONDS + STREAM_LOOKAHEAD_SECONDS
    const knownDuration = Number.isFinite(durationHint) && durationHint > 0

    let cursor = startAt
    let previousText = ''
    let producedAudio = false
    let lockedLanguage = null

    while (true) {
      if (signal?.aborted) return
      if (knownDuration && cursor >= durationHint - 0.1) break

      const { blob, seconds, exitCode } = await extractCompressedChunk(source.ffmpeg, cursor, windowLength)

      if (seconds < MIN_CHUNK_SECONDS) {
        if (!producedAudio) {
          throw new OnlineError(
            'other',
            exitCode !== 0 ? t('err.fileRead', { code: exitCode }) : t('err.noAudio')
          )
        }
        break
      }
      producedAudio = true

      const reachedEnd = seconds < windowLength - 1
      const ownedLimit = cursor + STREAM_CHUNK_SECONDS
      const windowEnd = cursor + seconds

      const { language, segments } = await transcribeChunk(blob, { apiKey, signal, prompt: previousText, language: lockedLanguage })

      recordAudioSeconds(seconds)
      const absolute = segments.map((s) => ({ ...s, start: cursor + s.start, end: cursor + s.end }))
      const owned = reachedEnd ? absolute : absolute.filter((s) => s.start < ownedLimit)
      const lastOwnedEnd = owned.length > 0 ? owned[owned.length - 1].end : 0
      const horizon = reachedEnd ? windowEnd : Math.min(Math.max(ownedLimit, lastOwnedEnd), windowEnd)

      // Les hallucinations sont écartées sur le texte d'origine, avant la
      // traduction : une fois traduites, leurs formules ne sont plus reconnaissables.
      const reliable = owned.filter((s) => s.reliable && !isLikelyHallucination(s.text))

      if (!lockedLanguage && reliable.length >= LANGUAGE_LOCK_MIN_SEGMENTS) {
        lockedLanguage = toIsoLanguageCode(language)
      }
      let texts = reliable.map((s) => s.text)

      if (texts.length > 0) {
        previousText = texts.join(' ').slice(-PROMPT_CONTEXT_CHARS)
        if (needsTranslation(lockedLanguage || language, targetLanguage)) {
          texts = await translate(texts)
        }
      }

      const clauses = reliable.map((s, i) => ({
        text: texts[i],
        startTime: s.start,
        endTime: Math.max(s.end, s.start + 0.1),
        words: []
      }))

      onWindow({
        startTime: cursor,
        endTime: horizon,
        horizon,
        clauses,
        language,
        analyzedSeconds: horizon - cursor
      })

      if (reachedEnd) break
      cursor = horizon
    }
  } finally {
    source.close()
  }
}
