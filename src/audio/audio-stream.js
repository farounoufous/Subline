// Extrait la piste audio d'une vidéo en flux (par morceaux) avec
// ffmpeg.wasm, puis détecte les passages réellement parlés avec Silero
// VAD (@ricky0123/vad-web) : un VAD reconnaît la voix humaine, alors
// qu'un simple seuil d'amplitude confond parole douce, musique et bruit.
//
// Pourquoi ffmpeg.wasm plutôt que decodeAudioData :
//  - le fichier est monté en lecture (WORKERFS) sans être copié en
//    mémoire : une vidéo de plusieurs Go ne sature plus l'onglet ;
//  - l'audio est converti directement en 16 kHz mono 16 bits, soit ~2 Mo
//    par minute au lieu de plusieurs dizaines de Mo en float32 natif ;
//  - les premiers segments sont disponibles après quelques secondes,
//    sans attendre le décodage de tout le fichier.

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { NonRealTimeVAD } from '@ricky0123/vad-web'
import {
  TARGET_SAMPLE_RATE,
  MAX_SEGMENT_DURATION_SECONDS,
  STREAM_CHUNK_SECONDS,
  STREAM_LOOKAHEAD_SECONDS
} from './constants.js'

const MOUNT_DIR = '/input'
const SOURCE_NAME = 'source'
const OUTPUT_NAME = 'chunk.pcm'

// En dessous de cette durée, le morceau est considéré comme vide.
const MIN_CHUNK_SAMPLES = TARGET_SAMPLE_RATE * 0.2

async function createVad() {
  return NonRealTimeVAD.new({
    modelURL: '/vad-assets/silero_vad_legacy.onnx',
    ortConfig: (ort) => {
      // Même runtime ONNX local que Whisper (une seule copie à héberger) : requis pour un
      // fonctionnement hors ligne.
      ort.env.wasm.wasmPaths = '/onnx-runtime/'
    }
  })
}

async function loadFfmpeg(file) {
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: '/ffmpeg/ffmpeg-core.js',
    wasmURL: '/ffmpeg/ffmpeg-core.wasm'
  })
  await ffmpeg.createDir(MOUNT_DIR)
  // Un File enveloppant le fichier d'origine : WORKERFS le lit à la
  // demande, sans le charger en mémoire.
  await ffmpeg.mount('WORKERFS', { files: [new File([file], SOURCE_NAME)] }, MOUNT_DIR)
  return ffmpeg
}

// Extrait [start, start + length) en 16 kHz mono PCM 16 bits.
async function extractPcm(ffmpeg, start, length) {
  const exitCode = await ffmpeg.exec([
    '-ss', String(start),
    '-t', String(length),
    '-i', `${MOUNT_DIR}/${SOURCE_NAME}`,
    '-vn', '-sn',
    '-ac', '1',
    '-ar', String(TARGET_SAMPLE_RATE),
    '-f', 's16le',
    '-y', OUTPUT_NAME
  ])

  if (exitCode !== 0) {
    return { samples: new Int16Array(0), exitCode }
  }

  const bytes = await ffmpeg.readFile(OUTPUT_NAME)
  await ffmpeg.deleteFile(OUTPUT_NAME)

  // Copie alignée : le Uint8Array renvoyé peut avoir un décalage impair.
  const copy = bytes.slice()
  const samples = new Int16Array(copy.buffer, 0, Math.floor(copy.byteLength / 2))
  return { samples, exitCode }
}

function int16ToFloat32(samples) {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] / 32768
  }
  return out
}

// Un passage de parole continue peut dépasser la fenêtre native de
// Whisper (30 s) : on le redécoupe alors en blocs de taille fixe. Limite
// connue : pas de recouvrement entre ces blocs, un mot pile à la coupure
// peut être perdu (cas rare : long monologue sans aucune pause).
function splitIfTooLong(segment) {
  if (segment.endTime - segment.startTime <= MAX_SEGMENT_DURATION_SECONDS) {
    return [segment]
  }

  const samplesPerChunk = MAX_SEGMENT_DURATION_SECONDS * TARGET_SAMPLE_RATE
  const chunks = []
  for (let offset = 0; offset < segment.audio.length; offset += samplesPerChunk) {
    chunks.push({
      audio: segment.audio.slice(offset, offset + samplesPerChunk),
      startTime: segment.startTime + offset / TARGET_SAMPLE_RATE,
      endTime: segment.startTime + Math.min(offset + samplesPerChunk, segment.audio.length) / TARGET_SAMPLE_RATE
    })
  }
  return chunks
}

/**
 * Générateur asynchrone : produit, morceau par morceau, les segments de
 * parole d'une vidéo, dans l'ordre chronologique.
 *
 * Chaque morceau "possède" les segments qui COMMENCENT dans sa fenêtre
 * de STREAM_CHUNK_SECONDS ; le morceau suivant démarre là où le dernier
 * segment possédé se termine, pour qu'aucune phrase ne soit coupée.
 *
 * @param {File} file
 * @param {{ durationHint?: number, signal?: AbortSignal }} options
 * @yields {{
 *   segments: { audio: Float32Array, startTime: number, endTime: number }[],
 *   horizon: number,            // instant jusqu'auquel l'audio est analysé
 *   speechSeconds: number,      // durée de parole trouvée dans ce morceau
 *   analyzedSeconds: number     // durée analysée dans ce morceau
 * }}
 */
export async function* streamAudioSegments(file, { durationHint, signal } = {}) {
  const ffmpeg = await loadFfmpeg(file)
  const abort = () => ffmpeg.terminate()
  signal?.addEventListener('abort', abort)

  try {
    const vad = await createVad()
    const windowLength = STREAM_CHUNK_SECONDS + STREAM_LOOKAHEAD_SECONDS
    const knownDuration = Number.isFinite(durationHint) && durationHint > 0

    let cursor = 0
    let producedAudio = false

    while (true) {
      if (signal?.aborted) return
      if (knownDuration && cursor >= durationHint - 0.1) break

      const { samples, exitCode } = await extractPcm(ffmpeg, cursor, windowLength)

      if (samples.length < MIN_CHUNK_SAMPLES) {
        if (!producedAudio) {
          throw new Error(
            exitCode !== 0
              ? `Lecture du fichier impossible (code ${exitCode}).`
              : 'Aucune piste audio exploitable dans cette vidéo.'
          )
        }
        break
      }
      producedAudio = true

      const windowSeconds = samples.length / TARGET_SAMPLE_RATE
      const reachedEnd = windowSeconds < windowLength - 0.5
      const ownedLimit = cursor + STREAM_CHUNK_SECONDS

      const owned = []
      for await (const { audio, start, end } of vad.run(int16ToFloat32(samples), TARGET_SAMPLE_RATE)) {
        const startTime = cursor + start / 1000
        if (!reachedEnd && startTime >= ownedLimit) break
        owned.push(...splitIfTooLong({ audio, startTime, endTime: cursor + end / 1000 }))
      }

      const lastOwnedEnd = owned.length > 0 ? owned[owned.length - 1].endTime : 0
      const windowEnd = cursor + windowSeconds
      const horizon = reachedEnd ? windowEnd : Math.min(Math.max(ownedLimit, lastOwnedEnd), windowEnd)
      const speechSeconds = owned.reduce((sum, s) => sum + (s.endTime - s.startTime), 0)

      yield { segments: owned, horizon, speechSeconds, analyzedSeconds: horizon - cursor }

      if (reachedEnd) break
      cursor = horizon
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    ffmpeg.terminate()
  }
}
