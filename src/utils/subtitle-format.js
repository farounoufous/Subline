// Mise en forme des sous-titres selon des règles de lisibilité :
// lignes courtes, 2 lignes maximum par bloc, durée minimale
// d'affichage et vitesse de lecture raisonnable.
//
// Le texte étant produit directement par Whisper en anglais, chaque mot
// porte son vrai timestamp : un bloc commence quand son premier mot est
// prononcé et se termine quand son dernier mot l'est.

import {
  MAX_LINE_CHARS,
  MAX_LINES_PER_BLOCK,
  MIN_SUBTITLE_DURATION_SECONDS,
  MAX_READING_CHARS_PER_SECOND
} from '../audio/constants.js'

// Si Whisper n'a pas fourni de mots horodatés, on en fabrique en
// répartissant le temps de la proposition au prorata des caractères.
function synthesizeWords({ text, startTime, endTime }) {
  const tokens = text.split(/\s+/).filter(Boolean)
  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0) || 1
  const duration = Math.max(endTime - startTime, 0.1)
  let cursor = startTime

  return tokens.map((token) => {
    const wordDuration = duration * (token.length / totalChars)
    const word = { text: token, startTime: cursor, endTime: cursor + wordDuration }
    cursor += wordDuration
    return word
  })
}

const lineLength = (words) => words.reduce((sum, w) => sum + w.text.length, 0) + Math.max(words.length - 1, 0)

// Découpe les mots en lignes de MAX_LINE_CHARS caractères maximum.
function wrapIntoLines(words) {
  const lines = []
  let current = []
  for (const word of words) {
    if (current.length > 0 && lineLength([...current, word]) > MAX_LINE_CHARS) {
      lines.push(current)
      current = [word]
    } else {
      current.push(word)
    }
  }
  if (current.length > 0) lines.push(current)
  return lines
}

// Pour un bloc de deux lignes, équilibre les longueurs en cherchant le
// point de coupe le plus proche du milieu (légère préférence pour une
// coupe après une virgule), plutôt que de laisser une ligne pleine et
// une ligne presque vide.
function balanceTwoLines(first, second) {
  const words = [...first, ...second]
  let best = null

  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i)
    const right = words.slice(i)
    if (lineLength(left) > MAX_LINE_CHARS || lineLength(right) > MAX_LINE_CHARS) continue

    const commaBonus = /[,;:]$/.test(left[left.length - 1].text) ? 4 : 0
    const score = Math.abs(lineLength(left) - lineLength(right)) - commaBonus
    if (!best || score < best.score) best = { score, left, right }
  }

  return best ? [best.left, best.right] : [first, second]
}

// Transforme une proposition { text, startTime, endTime, words } en un
// ou plusieurs blocs { text, startTime, endTime } ; text peut contenir
// un saut de ligne (2 lignes).
export function formatClause(clause) {
  const words = clause.words && clause.words.length > 0 ? clause.words : synthesizeWords(clause)
  if (words.length === 0) return []

  const lines = wrapIntoLines(words)
  const blocks = []

  for (let i = 0; i < lines.length; i += MAX_LINES_PER_BLOCK) {
    let group = lines.slice(i, i + MAX_LINES_PER_BLOCK)
    if (group.length === 2) group = balanceTwoLines(group[0], group[1])

    const blockWords = group.flat()
    blocks.push({
      text: group.map((line) => line.map((w) => w.text).join(' ')).join('\n'),
      startTime: blockWords[0].startTime,
      endTime: blockWords[blockWords.length - 1].endTime
    })
  }

  return blocks
}

// Ajuste les durées d'affichage d'une liste triée : chaque bloc reste
// affiché au moins MIN_SUBTITLE_DURATION_SECONDS et assez longtemps
// pour être lu à MAX_READING_CHARS_PER_SECOND, sans jamais chevaucher
// le bloc suivant. Idempotent : peut être rappelé après chaque ajout.
export function applyReadingTiming(sortedSubtitles) {
  for (let i = 0; i < sortedSubtitles.length; i++) {
    const current = sortedSubtitles[i]
    const next = sortedSubtitles[i + 1]
    const chars = current.text.replace('\n', ' ').length
    const needed = Math.max(MIN_SUBTITLE_DURATION_SECONDS, chars / MAX_READING_CHARS_PER_SECOND)

    let end = Math.max(current.endTime, current.startTime + needed)
    if (next) end = Math.min(end, next.startTime)
    current.endTime = Math.max(end, current.startTime + 0.1)
  }
}
