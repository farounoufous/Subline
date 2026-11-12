// Nettoyage des sous-titres : supprime les "hallucinations" typiques de
// Whisper et les répétitions parasites.
//
// Contexte : le score de non-parole (no_speech_prob), normalement le bon
// outil contre ce problème, n'est pas exposé par transformers.js. On s'en
// passe avec des heuristiques ciblées. Le VAD en amont écarte déjà la
// majorité des passages sans voix ; ces règles rattrapent le reste.
//
// Volontairement prudent : on ne supprime que des cas très reconnaissables,
// pour ne jamais effacer une vraie réplique ("Thank you." seul est
// conservé, par exemple).

const KNOWN_HALLUCINATIONS = [
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'like and subscribe',
  'subscribe to my channel',
  'see you in the next video',
  'subtitles by',
  'amara org',
  'transcribed by',
  'translated by'
]

// Étiquettes descriptives ajoutées par Whisper : [Music], (silence)...
const DESCRIPTIVE_TAG = /^[\[(*♪\s]*(music|musique|silence|blank_audio|applause|laughter|noise)[\])*♪\s.]*$/i
const NO_LETTERS = /^[^\p{L}\p{N}]*$/u

export function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Même mot 5 fois de suite, ou même groupe de mots répété 4 fois ou
// plus : boucle de répétition typique d'un décodage qui déraille.
function hasRunawayRepetition(normalized) {
  const words = normalized.split(' ')
  let run = 1
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1
    if (run >= 5) return true
  }
  return /(\b[\p{L}\p{N}']+(?: [\p{L}\p{N}']+){1,5}\b)(?: \1){3,}/u.test(normalized)
}

export function isLikelyHallucination(text) {
  const trimmed = text.trim()
  if (NO_LETTERS.test(trimmed) || DESCRIPTIVE_TAG.test(trimmed)) return true

  const normalized = normalizeText(trimmed)
  if (KNOWN_HALLUCINATIONS.some((phrase) => normalized.includes(phrase))) return true
  return hasRunawayRepetition(normalized)
}

// Écart maximal (en secondes) entre deux sous-titres identiques
// consécutifs pour considérer le second comme un doublon parasite.
const DUPLICATE_MAX_GAP_SECONDS = 8

/**
 * @param {{ text: string, startTime: number, endTime: number }[]} sortedSubtitles
 * @returns nouvelle liste sans hallucinations ni doublons consécutifs
 */
export function cleanSubtitles(sortedSubtitles) {
  const cleaned = []
  let previousNormalized = null
  let previousEnd = -Infinity

  for (const subtitle of sortedSubtitles) {
    if (isLikelyHallucination(subtitle.text)) continue

    const normalized = normalizeText(subtitle.text)
    const isDuplicate =
      normalized === previousNormalized && subtitle.startTime - previousEnd < DUPLICATE_MAX_GAP_SECONDS
    previousNormalized = normalized
    previousEnd = subtitle.endTime
    if (isDuplicate) continue

    cleaned.push(subtitle)
  }

  return cleaned
}
