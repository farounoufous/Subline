// Reconnaissance des fichiers vidéo et audio. Le type MIME seul ne suffit
// pas : Windows déclare souvent un MKV avec un type vide.

const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'ogv', 'mpg', 'mpeg', 'ts', '3gp', 'flv', 'wmv']
const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'weba']

export const PICKER_TYPES = [
  {
    description: 'Video / audio',
    accept: {
      'video/*': VIDEO_EXTENSIONS.map((ext) => `.${ext}`),
      'audio/*': AUDIO_EXTENSIONS.map((ext) => `.${ext}`)
    }
  }
]

export const FILE_INPUT_ACCEPT = ['video/*', 'audio/*', ...VIDEO_EXTENSIONS.map((e) => `.${e}`), ...AUDIO_EXTENSIONS.map((e) => `.${e}`)].join(',')

/** @returns {'video' | 'audio' | null} */
export function mediaKind(file) {
  if (!file) return null
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  const extension = file.name.split('.').pop().toLowerCase()
  if (VIDEO_EXTENSIONS.includes(extension)) return 'video'
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio'
  return null
}
