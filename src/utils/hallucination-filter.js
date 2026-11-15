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

// Formules typiques de Whisper (anglais et français), écrites sous la forme
// normalisée par normalizeText : minuscules, sans accents ni ponctuation.
const KNOWN_HALLUCINATIONS = [
  // Anglais
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'like and subscribe',
  'subscribe to my channel',
  'see you in the next video',
  'subtitles by',
  'amara org',
  'transcribed by',
  'translated by',
  // Français
  'sous titrage st',
  'sous titrage societe radio canada',
  'sous titres realises par',
  'sous titres par',
  'merci d avoir regarde',
  'n oubliez pas de vous abonner',
  'abonnez vous a la chaine',
  'a bientot pour une nouvelle video',
  'a la prochaine pour une nouvelle video'
]

// Une formule n'est écartée que si elle ouvre ou clôt la ligne et en occupe
// l'essentiel : un vrai « merci d'avoir regardé » au milieu d'une phrase reste.
const PHRASE_EXTRA_WORDS_ALLOWED = 6

// Mentions qui ne sont jamais de la parole réelle : écartées où qu'elles soient.
const ALWAYS_HALLUCINATION = ['amara org']

// Étiquettes descriptives ajoutées par Whisper : [Music], (silence)...
const DESCRIPTIVE_TAG = /^[\[(*♪\s]*(music|musique|silence|blank_audio|applause|laughter|noise)[\])*♪\s.]*$/i
const NO_LETTERS = /^[^\p{L}\p{N}]*$/u

export function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Boucle de répétition typique d'un décodage qui déraille : un même mot
// 8 fois de suite, ou un même groupe de 2 à 6 mots répété 5 fois ou plus.
// Les seuils sont volontairement hauts : la vraie parole répète parfois
// (« non non non non non ») ; une hallucination boucle bien plus longtemps.
// Détection par mots, sans expression régulière à lookbehind (non
// supportée par les Safari antérieurs à 16.4).
const MAX_WORD_RUN = 8
const MAX_GROUP_REPEATS = 5

function hasRunawayRepetition(normalized) {
  const words = normalized.split(' ')

  let run = 1
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1
    if (run >= MAX_WORD_RUN) return true
  }

  // Un groupe de `size` mots répété R fois correspond à une suite de
  // size × (R - 1) mots identiques à ceux situés `size` positions avant.
  for (let size = 2; size <= 6; size++) {
    let matches = 0
    for (let i = size; i < words.length; i++) {
      matches = words[i] === words[i - size] ? matches + 1 : 0
      if (matches >= size * (MAX_GROUP_REPEATS - 1)) return true
    }
  }
  return false
}

export function isLikelyHallucination(text) {
  const trimmed = text.trim()
  if (NO_LETTERS.test(trimmed) || DESCRIPTIVE_TAG.test(trimmed)) return true

  const normalized = normalizeText(trimmed)
  const wordCount = normalized.split(' ').length
  const isKnownPhrase = KNOWN_HALLUCINATIONS.some(
    (phrase) =>
      (normalized.startsWith(phrase) || normalized.endsWith(phrase)) &&
      wordCount <= phrase.split(' ').length + PHRASE_EXTRA_WORDS_ALLOWED
  )
  if (isKnownPhrase || ALWAYS_HALLUCINATION.some((phrase) => normalized.includes(phrase))) return true
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
