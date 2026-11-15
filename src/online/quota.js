// Suivi du quota gratuit Groq (transcription : secondes d'audio par heure
// et par jour).
//
// Deux sources, croisées :
//  - un journal local des secondes d'audio envoyées par cet appareil
//    (localStorage) : estimation toujours disponible ;
//  - les valeurs réelles quand Groq les communique : message d'une erreur
//    429 ("Limit 7200, Used 7100...") et en-têtes x-ratelimit-* quand le
//    navigateur est autorisé à les lire.
//
// Le compte réel de Groq (clé partagée avec d'autres usages, autre
// appareil) peut être plus élevé que l'estimation locale : on garde le
// plus grand des deux tant que la valeur de Groq est récente.

import { reactive } from 'vue'

const LOG_KEY = 'subline:audio-log'
const SERVER_KEY = 'subline:quota-server'
const DATA_KEY = 'subline:data-sent'
const DATA_RETENTION_DAYS = 62
const HOUR = 3600
const DAY = 86400
// Valeurs documentées du palier gratuit pour whisper-large-v3.
export const DEFAULT_LIMITS = { hour: 7200, day: 28800 }
// Groq facture au minimum 10 s d'audio par requête.
const MIN_BILLED_SECONDS = 10

export const quota = reactive({
  usedHour: 0,
  usedDay: 0,
  limitHour: DEFAULT_LIMITS.hour,
  limitDay: DEFAULT_LIMITS.day,
  requestsLeft: null,
  // Données envoyées (octets) : aujourd'hui, ce mois-ci, depuis le chargement de la page.
  dataToday: 0,
  dataMonth: 0,
  sessionBytes: 0
})

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sans conséquence : le suivi devient simplement moins précis.
  }
}

const now = () => Date.now() / 1000

export function refreshQuota() {
  const t0 = now()
  const log = readJson(LOG_KEY, []).filter((entry) => entry.t > t0 - DAY)
  const localHour = log.filter((e) => e.t > t0 - HOUR).reduce((sum, e) => sum + e.s, 0)
  const localDay = log.reduce((sum, e) => sum + e.s, 0)

  const server = readJson(SERVER_KEY, {})
  const fresh = (entry, window) => entry && entry.at > t0 - window
  quota.limitHour = fresh(server.hour, DAY) ? server.hour.limit : DEFAULT_LIMITS.hour
  quota.limitDay = fresh(server.day, DAY) ? server.day.limit : DEFAULT_LIMITS.day
  quota.usedHour = Math.max(localHour, fresh(server.hour, HOUR) ? server.hour.used : 0)
  quota.usedDay = Math.max(localDay, fresh(server.day, DAY) ? server.day.used : 0)
  quota.requestsLeft = fresh(server.requests, DAY) ? server.requests.left : null

  const data = readJson(DATA_KEY, {})
  const today = dayKey(new Date())
  quota.dataToday = data[today] || 0
  quota.dataMonth = Object.entries(data)
    .filter(([key]) => key.startsWith(today.slice(0, 7)))
    .reduce((sum, [, bytes]) => sum + bytes, 0)
}

// Clé de jour locale (AAAA-MM-JJ) : "aujourd'hui" suit le fuseau de l'utilisateur.
function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** À appeler pour chaque requête qui envoie des données à Groq. */
export function recordBytesSent(bytes) {
  if (!(bytes > 0)) return
  const data = readJson(DATA_KEY, {})
  const today = dayKey(new Date())
  data[today] = (data[today] || 0) + bytes
  const oldest = dayKey(new Date(Date.now() - DATA_RETENTION_DAYS * DAY * 1000))
  for (const key of Object.keys(data)) if (key < oldest) delete data[key]
  writeJson(DATA_KEY, data)
  quota.sessionBytes += bytes
  refreshQuota()
}

/** À appeler après chaque transcription réussie. */
export function recordAudioSeconds(seconds) {
  const t0 = now()
  const log = readJson(LOG_KEY, []).filter((entry) => entry.t > t0 - DAY)
  log.push({ t: t0, s: Math.max(MIN_BILLED_SECONDS, Math.round(seconds)) })
  writeJson(LOG_KEY, log)
  refreshQuota()
}

function updateServer(patch) {
  writeJson(SERVER_KEY, { ...readJson(SERVER_KEY, {}), ...patch })
  refreshQuota()
}

/** En-têtes x-ratelimit-* (lisibles seulement si Groq les expose en CORS). */
export function recordRateLimitHeaders(headers) {
  const remaining = Number(headers.get('x-ratelimit-remaining-requests'))
  if (headers.get('x-ratelimit-remaining-requests') !== null && Number.isFinite(remaining)) {
    updateServer({ requests: { left: remaining, at: now() } })
  }
}

/**
 * "Please try again in 1h5m3.5s" -> secondes. Sert quand l'en-tête
 * retry-after n'est pas lisible par le navigateur.
 */
export function parseRetryAfterSeconds(message) {
  const match = /try again in\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?/i.exec(message || '')
  if (!match || (!match[1] && !match[2] && !match[3])) return null
  return Math.ceil(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0))
}

/** Message d'une erreur 429 : "... (ASPH): Limit 7200, Used 7100, Requested 400 ...". */
export function recordLimitFromMessage(message) {
  const match = /\((ASPH|ASPD)\)[^]*?Limit\s+(\d+)[^]*?Used\s+(\d+)/i.exec(message || '')
  if (!match) return
  const entry = { limit: Number(match[2]), used: Number(match[3]), at: now() }
  updateServer(match[1].toUpperCase() === 'ASPH' ? { hour: entry } : { day: entry })
}
