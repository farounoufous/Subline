// Décode l'intégralité de la piste audio d'un fichier vidéo, puis
// détecte les passages réellement parlés via un VAD (Voice Activity
// Detection) dédié — Silero VAD, via @ricky0123/vad-web — plutôt que de
// découper en blocs fixes et de mesurer une simple amplitude moyenne
// (RMS). Un seuil RMS ne distingue pas la parole douce d'une musique
// sans voix, ni la parole mélangée à de la musique : Silero VAD est
// entraîné spécifiquement à reconnaître la voix humaine, et règle ce
// problème à la racine plutôt que de continuer à ajuster un seuil.
//
// Chaque segment renvoyé par le VAD correspond à un passage de parole
// continue, avec un timing réel (pas un découpage arbitraire toutes les
// N secondes) : un passage de silence entre deux répliques n'est jamais
// envoyé à Whisper, et une réplique n'est jamais coupée au milieu par
// un découpage fixe mal placé.

import { NonRealTimeVAD } from '@ricky0123/vad-web'
import { TARGET_SAMPLE_RATE, MAX_SEGMENT_DURATION_SECONDS } from './constants.js'

// Fusionne plusieurs canaux (stéréo, etc.) en un seul canal mono, en
// faisant la moyenne des échantillons de chaque canal.
function downmixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0)
  }

  const length = audioBuffer.length
  const mono = new Float32Array(length)
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
    const channelData = audioBuffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / audioBuffer.numberOfChannels
    }
  }
  return mono
}

// Le VAD ré-échantillonne lui-même en interne vers 16 kHz pour son
// propre modèle, et renvoie l'audio de chaque segment de parole déjà à
// cette fréquence : pas besoin d'un ré-échantillonnage séparé de notre
// côté, contrairement à l'ancienne approche par blocs fixes.
async function detectSpeechSegments(monoAudio, nativeSampleRate) {
  const vad = await NonRealTimeVAD.new({
    modelURL: '/vad-assets/silero_vad_legacy.onnx',
    ortConfig: (ort) => {
      // Même logique que pour le runtime ONNX de transformers.js :
      // héberger localement plutôt que dépendre d'un CDN externe, pour
      // un vrai fonctionnement hors-ligne une fois les fichiers en cache.
      ort.env.wasm.wasmPaths = '/vad-assets/'
    }
  })

  const speechSegments = []
  for await (const { audio, start, end } of vad.run(monoAudio, nativeSampleRate)) {
    speechSegments.push({ audio, startTime: start / 1000, endTime: end / 1000 })
  }
  return speechSegments
}

// Un passage de parole continue peut dépasser la fenêtre native de
// Whisper (30s) — rare (un long monologue sans pause détectée par le
// VAD), mais possible. On le redécoupe alors en blocs de taille fixe.
// Limite connue et assumée : ce découpage forcé n'a pas de recouvrement
// entre les blocs (contrairement aux frontières naturelles que trouve
// le VAD), donc un mot pile à la coupure peut être perdu dans ce cas
// précis seulement — un vrai recouvrement avec dédoublonnage du texte
// est un chantier à part entière, hors de portée ici pour un cas aussi
// marginal.
function splitIfTooLong(segment) {
  const duration = segment.endTime - segment.startTime
  if (duration <= MAX_SEGMENT_DURATION_SECONDS) {
    return [segment]
  }

  const samplesPerChunk = MAX_SEGMENT_DURATION_SECONDS * TARGET_SAMPLE_RATE
  const chunks = []

  for (let offset = 0; offset < segment.audio.length; offset += samplesPerChunk) {
    const audio = segment.audio.slice(offset, offset + samplesPerChunk)
    const startTime = segment.startTime + offset / TARGET_SAMPLE_RATE
    const endTime = segment.startTime + Math.min(offset + samplesPerChunk, segment.audio.length) / TARGET_SAMPLE_RATE
    chunks.push({ audio, startTime, endTime })
  }

  return chunks
}

/**
 * Décode la piste audio d'un fichier vidéo et détecte les passages
 * réellement parlés, prêts à être envoyés à Whisper.
 *
 * @param {File} file
 * @returns {Promise<{
 *   segments: { audio: Float32Array, startTime: number, endTime: number }[],
 *   totalDuration: number,
 *   silenceSkippedSeconds: number
 * }>}
 */
export async function decodeAudioSegments(file) {
  const arrayBuffer = await file.arrayBuffer()

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  const audioContext = new AudioContextClass()

  let audioBuffer
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  } finally {
    await audioContext.close()
  }

  const monoData = downmixToMono(audioBuffer)
  const speechSegments = await detectSpeechSegments(monoData, audioBuffer.sampleRate)

  const segments = []
  for (const speechSegment of speechSegments) {
    segments.push(...splitIfTooLong(speechSegment))
  }

  const totalSpeechDuration = speechSegments.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)
  const silenceSkippedSeconds = Math.max(0, audioBuffer.duration - totalSpeechDuration)

  return {
    segments,
    totalDuration: audioBuffer.duration,
    silenceSkippedSeconds
  }
}
