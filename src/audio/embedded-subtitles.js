// Sous-titres intégrés à un fichier vidéo (MKV, MP4...) : liste des pistes
// puis extraction d'une piste texte en SRT, avec ffmpeg.wasm. Le fichier
// est lu à la demande (WORKERFS) : rien n'est copié en mémoire.
//
// Les pistes "image" (PGS des Blu-ray, VobSub des DVD) sont des bitmaps :
// elles ne contiennent pas de texte et sont signalées comme illisibles
// (il faudrait de la reconnaissance de caractères).

import { openMediaSource } from './audio-stream.js'
import { parseSrt } from '../utils/subtitle-parse.js'

const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'subviewer', 'subviewer1', 'microdvd', 'jacosub', 'sami', 'realtext', 'stl', 'vplayer', 'mpl2', 'pjs'])

const STREAM_LINE = /Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?[^:]*:\s*Subtitle:\s*([\w]+)/
const TITLE_LINE = /^\s+title\s*:\s*(.+)$/i

// Codes ISO 639-2 (utilisés par les conteneurs) vers les deux langues de l'app.
const LANGUAGE_CODES = {
  eng: 'en', en: 'en',
  fre: 'fr', fra: 'fr', fr: 'fr'
}

export function normalizeTrackLanguage(code) {
  if (!code) return null
  const value = code.toLowerCase()
  if (value === 'und' || value === 'unk') return null
  return LANGUAGE_CODES[value] || value
}

/**
 * @returns {Promise<{ index: number, language: string | null, codec: string, title: string, readable: boolean }[]>}
 *   index : rang parmi les pistes de sous-titres (pour -map 0:s:index)
 */
export async function probeSubtitleTracks(file, signal) {
  const source = await openMediaSource(file, signal)
  const tracks = []
  let lastTrack = null

  source.ffmpeg.on('log', ({ message }) => {
    const stream = STREAM_LINE.exec(message)
    if (stream) {
      lastTrack = {
        index: tracks.length,
        language: normalizeTrackLanguage(stream[2]),
        codec: stream[3].toLowerCase(),
        title: '',
        readable: TEXT_CODECS.has(stream[3].toLowerCase())
      }
      tracks.push(lastTrack)
      return
    }
    if (/Stream #/.test(message)) {
      lastTrack = null
      return
    }
    const title = lastTrack && TITLE_LINE.exec(message)
    if (title) lastTrack.title = title[1].trim()
  })

  try {
    // Sans fichier de sortie, ffmpeg s'arrête en erreur après avoir décrit
    // les flux : c'est le comportement attendu pour une simple lecture.
    await source.ffmpeg.exec(['-hide_banner', '-i', '/input/source'])
    return tracks
  } finally {
    source.close()
  }
}

/**
 * Extrait une piste texte et la renvoie sous forme de répliques.
 * @returns {Promise<{ start: number, end: number, text: string }[]>}
 */
export async function extractSubtitleCues(file, trackIndex, signal) {
  const source = await openMediaSource(file, signal)
  try {
    const exitCode = await source.ffmpeg.exec([
      '-i', '/input/source',
      '-map', `0:s:${trackIndex}`,
      '-c:s', 'srt',
      '-f', 'srt',
      '-y', 'track.srt'
    ])
    if (exitCode !== 0) return []
    const bytes = await source.ffmpeg.readFile('track.srt')
    return parseSrt(new TextDecoder('utf-8').decode(bytes))
  } finally {
    source.close()
  }
}
