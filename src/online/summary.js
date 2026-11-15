// Résumé et chapitres d'une vidéo à partir du texte de ses sous-titres.
// Aucun audio ni image : seul le texte part vers le modèle de langage.
//
// Les limites du palier gratuit (quelques milliers de jetons par minute)
// interdisent d'envoyer une longue transcription d'un coup : on la découpe
// en parties, chacune donne un résumé et des chapitres, puis un dernier
// appel fusionne les résumés partiels en un résumé unique.

import { t } from '../i18n/index.js'
import { createChatClient, LANGUAGE_NAMES, OnlineError } from './groq-client.js'

// Taille d'une partie (caractères) : environ 2 500 jetons, ce qui laisse de
// la marge pour la consigne et la réponse sous la limite par minute.
export const PART_MAX_CHARS = 9000
// Une ligne regroupe les sous-titres rapprochés (moins de repères à transmettre).
const LINE_MAX_CHARS = 280
const LINE_MAX_GAP_SECONDS = 8
// Rattachement d'une dernière partie minuscule (voir splitIntoParts).
const SMALL_LAST_PART_RATIO = 0.2
const MAX_OVERFLOW_RATIO = 1.25
// Textes trop courts pour mériter un résumé.
const MIN_TRANSCRIPT_CHARS = 200
// Deux chapitres plus proches que cela sont fusionnés.
const MIN_CHAPTER_GAP_SECONDS = 45
const MAX_TITLE_CHARS = 90

/** Regroupe les sous-titres en lignes "[secondes] texte". */
export function buildTranscriptLines(subtitles) {
  const lines = []
  let current = null
  for (const subtitle of subtitles) {
    const text = subtitle.text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const gap = current ? subtitle.startTime - current.end : 0
    if (current && gap <= LINE_MAX_GAP_SECONDS && current.text.length + text.length < LINE_MAX_CHARS) {
      current.text += ' ' + text
      current.end = subtitle.endTime
    } else {
      current = { time: Math.floor(subtitle.startTime), end: subtitle.endTime, text }
      lines.push(current)
    }
  }
  return lines
}

/** Découpe les lignes en parties d'au plus `maxChars` caractères. */
export function splitIntoParts(lines, maxChars = PART_MAX_CHARS) {
  const parts = []
  let current = []
  let chars = 0
  for (const line of lines) {
    const size = line.text.length + 8
    if (current.length > 0 && chars + size > maxChars) {
      parts.push(current)
      current = []
      chars = 0
    }
    current.push(line)
    chars += size
  }
  if (current.length > 0) parts.push(current)

  // Une dernière partie minuscule coûterait un appel entier pour presque
  // rien : on la rattache à la précédente si le total reste raisonnable.
  const size = (part) => part.reduce((sum, line) => sum + line.text.length + 8, 0)
  if (parts.length > 1) {
    const last = parts[parts.length - 1]
    const previous = parts[parts.length - 2]
    if (size(last) < maxChars * SMALL_LAST_PART_RATIO && size(previous) + size(last) <= maxChars * MAX_OVERFLOW_RATIO) {
      parts.splice(parts.length - 2, 2, [...previous, ...last])
    }
  }
  return parts
}

/** Supprime les chapitres trop proches, trie par temps, borne les titres. */
export function mergeChapters(chapters) {
  const sorted = [...chapters].sort((a, b) => a.time - b.time)
  const kept = []
  for (const chapter of sorted) {
    const last = kept[kept.length - 1]
    if (last && chapter.time - last.time < MIN_CHAPTER_GAP_SECONDS) continue
    kept.push({ time: chapter.time, title: chapter.title.slice(0, MAX_TITLE_CHARS) })
  }
  return kept
}

function validatePart(parsed) {
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim() || !Array.isArray(parsed.chapters)) {
    throw new OnlineError('other', t('err.unexpectedSummary'))
  }
  const chapters = parsed.chapters
    .map((chapter) => ({ time: Number(chapter?.time), title: String(chapter?.title || '').trim() }))
    .filter((chapter) => Number.isFinite(chapter.time) && chapter.title)
  return { summary: parsed.summary.trim(), chapters }
}

/**
 * @param {{ startTime: number, endTime: number, text: string }[]} subtitles
 * @param {{ apiKey: string, language: 'fr'|'en', signal?: AbortSignal, onProgress?: (done: number, total: number) => void }} options
 * @returns {Promise<{ summary: string, chapters: { time: number, title: string }[], language: string }>}
 */
export async function generateOutline(subtitles, { apiKey, language, signal, onProgress }) {
  const lines = buildTranscriptLines(subtitles)
  if (lines.reduce((sum, line) => sum + line.text.length, 0) < MIN_TRANSCRIPT_CHARS) {
    throw new OnlineError('other', t('outline.tooShort'))
  }

  const languageName = LANGUAGE_NAMES[language] || 'English'
  const completeJson = createChatClient({ apiKey, signal })
  const parts = splitIntoParts(lines)
  const total = parts.length + (parts.length > 1 ? 1 : 0)
  let done = 0
  onProgress?.(done, total)

  const results = []
  for (const part of parts) {
    const first = part[0].time
    const last = part[part.length - 1].time
    const system =
      `You analyse an excerpt of a video transcript. Each line starts with the time in seconds: [123] text. Write in ${languageName}. ` +
      'Reply only with a JSON object {"summary": string, "chapters": [{"time": integer, "title": string}]}. ' +
      'The summary has 2 to 3 sentences about this excerpt. Chapters mark real changes of topic: give 1 to 4, ' +
      `each "time" must be one of the line markers (between ${first} and ${last}) and each title at most 8 words. ` +
      'Do not invent information that is not in the text.'
    const user = part.map((line) => `[${line.time}] ${line.text}`).join('\n')

    const result = await completeJson({ system, user, validate: validatePart })
    results.push({
      summary: result.summary,
      // Un chapitre doit pointer un repère de l'extrait : les autres sont
      // des inventions du modèle et sont écartés.
      chapters: result.chapters
        .map((chapter) => ({ ...chapter, time: Math.round(chapter.time) }))
        .filter((chapter) => chapter.time >= first && chapter.time <= last)
    })
    onProgress?.(++done, total)
  }

  let summary = results[0].summary
  if (results.length > 1) {
    const system =
      `You are given summaries of consecutive parts of one video. Write a single cohesive summary of 4 to 7 sentences in ${languageName}. ` +
      'Reply only with a JSON object {"summary": string}. Do not invent information.'
    const merged = await completeJson({
      system,
      user: JSON.stringify({ parts: results.map((result) => result.summary) }),
      validate(parsed) {
        if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) throw new OnlineError('other', t('err.unexpectedSummary'))
        return parsed.summary.trim()
      }
    })
    summary = merged
    onProgress?.(++done, total)
  }

  return {
    summary,
    chapters: mergeChapters(results.flatMap((result) => result.chapters)),
    language,
    createdAt: Date.now()
  }
}
