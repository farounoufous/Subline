// Export des sous-titres aux formats SubRip (.srt) et WebVTT (.vtt).

function pad(value, length = 2) {
  return String(value).padStart(length, '0')
}

function formatTimestamp(totalSeconds, millisecondSeparator) {
  const totalMs = Math.max(0, Math.round(totalSeconds * 1000))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  const seconds = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${millisecondSeparator}${pad(ms, 3)}`
}

export function toSrt(subtitles) {
  return subtitles
    .map((s, index) => `${index + 1}\n${formatTimestamp(s.startTime, ',')} --> ${formatTimestamp(s.endTime, ',')}\n${s.text}\n`)
    .join('\n')
}

export function toVtt(subtitles) {
  const cues = subtitles
    .map((s) => `${formatTimestamp(s.startTime, '.')} --> ${formatTimestamp(s.endTime, '.')}\n${s.text}\n`)
    .join('\n')
  return `WEBVTT\n\n${cues}`
}

export function downloadTextFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
