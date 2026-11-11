// Capture une miniature d'une vidéo à partir de son URL, via un élément
// <video> hors DOM (indépendant du lecteur visible, qui n'est pas
// perturbé). Retourne null en cas d'échec ou de délai dépassé : une
// miniature manquante ne doit jamais empêcher la sauvegarde du reste.

const THUMBNAIL_WIDTH = 320
const CAPTURE_TIMEOUT_MS = 8000

export function captureThumbnail(videoUrl) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'metadata'
    video.playsInline = true

    const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS)

    function finish(result) {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      resolve(result)
    }

    video.onerror = () => finish(null)

    video.onloadedmetadata = () => {
      // Une image un peu après le début évite souvent un écran noir.
      const target = Number.isFinite(video.duration) ? Math.min(2, video.duration * 0.1) : 0
      video.currentTime = target
    }

    video.onseeked = () => {
      try {
        const ratio = video.videoHeight / video.videoWidth || 9 / 16
        const canvas = document.createElement('canvas')
        canvas.width = THUMBNAIL_WIDTH
        canvas.height = Math.round(THUMBNAIL_WIDTH * ratio)
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        finish(null)
      }
    }

    video.src = videoUrl
  })
}
