// Lecture d'un fichier SRT en une liste de répliques { start, end, text }.
// Tolérant : BOM, fins de ligne Windows, numéros absents ou faux, balises
// HTML (<i>, <font>) et codes ASS résiduels ({\an8}, \N).

const TIMING_LINE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/

function toSeconds(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

export function cleanCueText(raw) {
  return raw
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSrt(content) {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues = []

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line))
    if (timingIndex === -1) continue

    const match = TIMING_LINE.exec(lines[timingIndex])
    const start = toSeconds(match[1], match[2], match[3], match[4])
    const end = toSeconds(match[5], match[6], match[7], match[8])
    const body = cleanCueText(lines.slice(timingIndex + 1).join('\n'))
    if (!body || end <= start) continue

    cues.push({ start, end, text: body })
  }

  return cues.sort((a, b) => a.start - b.start)
}
