// Worker d'inférence IA, isolé du thread principal.
//
// Ce fichier est instancié plusieurs fois en parallèle par
// worker-pool.js (un Worker par cœur disponible, dans une limite
// raisonnable) : chaque instance charge sa propre copie des modèles et
// traite un segment à la fois, à la demande du pool (message
// PROCESS_SEGMENT) — c'est le pool qui décide quel segment envoyer
// ensuite à quel worker, dans l'ordre chronologique de la vidéo.
//
// Pipeline : Whisper uniquement, sortie toujours en anglais.
//  - mode 'english'   : la vidéo est en anglais -> simple transcription
//                       (task 'transcribe', langue forcée), plus précise.
//  - mode 'translate' : autre langue -> Whisper traduit directement vers
//                       l'anglais (task 'translate'), sans détection de
//                       langue de notre part (peu fiable dans
//                       transformers.js).
// Aucun second modèle de traduction : un seul téléchargement, moins de
// mémoire, et des timestamps par mot directement sur le texte final.

import { pipeline, env } from '@huggingface/transformers'
import { CLAUSE_PAUSE_GAP_SECONDS } from '../audio/constants.js'

// Par défaut, transformers.js charge le runtime ONNX (le programme qui
// exécute les modèles) depuis un CDN externe (cdn.jsdelivr.net) — même
// quand les poids des modèles, eux, sont bien mis en cache localement.
// Ça casse le fonctionnement 100% hors-ligne visé par ce projet. On
// pointe donc explicitement vers la copie locale, servie depuis
// /public/onnx-runtime (voir aussi service-worker.js pour son cache).
env.backends.onnx.wasm.wasmPaths = '/onnx-runtime/'

// Force explicitement la mise en cache des poids du modèle dans Cache
// Storage, pour un usage hors-ligne après le premier téléchargement.
env.useBrowserCache = true

const WHISPER_MODEL = 'Xenova/whisper-small'

// q8 (quantification int8) plutôt que le fp32 par défaut : environ
// 3 fois moins de données à télécharger, pour une perte de précision
// négligeable sur un usage de sous-titrage.
const MODEL_DTYPE = 'q8'

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Délai de ${ms}ms dépassé`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

// progress_callback : transformers.js appelle cette fonction pour
// chaque fichier téléchargé (encodeur, décodeur, tokenizer...), avec sa
// propre progression. On agrège tous les fichiers vus jusqu'ici pour
// calculer un pourcentage global, plutôt qu'un pourcentage par fichier
// qui bondirait de façon incohérente d'un fichier à l'autre. Un modèle
// déjà en cache ne déclenche jamais d'événement "progress" (chargement
// quasi instantané depuis le disque) : cette fonction ne sera alors
// simplement jamais appelée, ce qui est le comportement voulu.
const fileProgress = new Map()

function onDownloadProgress(data) {
  if (data.status !== 'progress' || !data.total) {
    return
  }

  fileProgress.set(data.file, { loaded: data.loaded, total: data.total })

  let loadedSum = 0
  let totalSum = 0
  for (const entry of fileProgress.values()) {
    loadedSum += entry.loaded
    totalSum += entry.total
  }

  if (totalSum > 0) {
    self.postMessage({ type: 'MODEL_PROGRESS', percent: (loadedSum / totalSum) * 100 })
  }
}

// WebGPU a échoué deux fois différemment sur cette configuration
// (blocage total, puis lenteur excessive même après correction de la
// concurrence). On abandonne WebGPU et on reste sur WASM, fiable dans
// nos tests, quitte à être plus lent — acceptable en traitement de
// fond sans contrainte de temps réel.
async function loadPipelineWithFallback(task, model) {
  return await pipeline(task, model, {
    device: 'wasm',
    dtype: MODEL_DTYPE,
    progress_callback: onDownloadProgress
  })
}

let transcriber = null
let modelsReady = null

async function loadModels() {
  self.postMessage({ type: 'MODELS_LOADING' })

  transcriber = await loadPipelineWithFallback('automatic-speech-recognition', WHISPER_MODEL)

  self.postMessage({ type: 'MODELS_READY' })
}

// Généreux : en traitement de fond, il n'y a pas de contrainte de
// temps réel. Ce délai protège seulement contre un blocage total
// (comme observé une fois avec WebGPU), pas contre une lenteur normale.
const SEGMENT_INFERENCE_TIMEOUT_MS = 180000

// Regroupe les mots horodatés en propositions : on coupe sur la
// ponctuation de fin de phrase ou sur une pause marquée entre deux mots.
// Les timestamps de Whisper sont relatifs au début du segment ; on les
// décale de segmentStartTime pour obtenir le temps absolu dans la vidéo.
function groupWordsIntoClauses(chunks, segmentStartTime) {
  const clauses = []
  let words = []
  let clauseStart = null
  let clauseEnd = null

  const flush = () => {
    if (words.length > 0) {
      clauses.push({
        text: words.map((w) => w.text).join('').trim(),
        startTime: clauseStart,
        endTime: clauseEnd,
        words: words
          .map((w) => ({ text: w.text.trim(), startTime: w.startTime, endTime: w.endTime }))
          .filter((w) => w.text)
      })
    }
    words = []
    clauseStart = null
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const [rawStart, rawEnd] = chunk.timestamp
    const start = segmentStartTime + rawStart
    const end = segmentStartTime + (rawEnd ?? rawStart + 0.3)

    if (clauseStart === null) clauseStart = start
    words.push({ text: chunk.text, startTime: start, endTime: end })
    clauseEnd = end

    const next = chunks[i + 1]
    const endsSentence = /[.!?]\s*$/.test(chunk.text)
    const longPause = next ? segmentStartTime + next.timestamp[0] - end > CLAUSE_PAUSE_GAP_SECONDS : false

    if (endsSentence || longPause) flush()
  }
  flush()

  return clauses.filter((clause) => clause.text)
}

// Contexte glissant : le texte anglais du segment précédent traité par
// CE worker sert de prompt à Whisper (meilleure cohérence des noms
// propres et du vocabulaire). Limité à un worker : le pool traite les
// segments en parallèle, donc le "précédent" n'est pas toujours le
// voisin chronologique. Désactivé automatiquement si non supporté.
let previousEnglishText = ''
let promptIdsSupported = true

async function processOneSegment(segment, mode) {
  const { audio, startTime, endTime } = segment

  try {
    const options = mode === 'translate'
      ? { task: 'translate', return_timestamps: 'word' }
      : { task: 'transcribe', language: 'english', return_timestamps: 'word' }

    if (promptIdsSupported && previousEnglishText) {
      try {
        options.prompt_ids = transcriber.tokenizer.get_prompt_ids(previousEnglishText)
      } catch (error) {
        promptIdsSupported = false
        console.warn('prompt_ids non supporté, contexte désactivé :', error.message)
      }
    }

    const transcription = await withTimeout(
      transcriber(audio, options),
      SEGMENT_INFERENCE_TIMEOUT_MS
    )
    const englishText = transcription.text.trim()

    if (englishText) {
      previousEnglishText = englishText.slice(-200)

      const clauses = groupWordsIntoClauses(transcription.chunks || [], startTime)

      // Repli : sans mots horodatés, tout le segment forme une proposition.
      const effective = clauses.length > 0
        ? clauses
        : [{ text: englishText, startTime, endTime, words: [] }]

      for (const clause of effective) {
        self.postMessage({ type: 'SUBTITLE', ...clause })
      }
    }
  } catch (error) {
    self.postMessage({ type: 'ERROR', message: `Échec de l'inférence sur un segment : ${error.message}` })
  }

  self.postMessage({ type: 'SEGMENT_DONE' })
}

self.onmessage = (event) => {
  if (event.data.type === 'START_LOADING') {
    // Ne déclenche le téléchargement qu'une seule fois, même si le
    // message arrive plusieurs fois par erreur.
    if (!modelsReady) {
      modelsReady = loadModels().catch((error) => {
        self.postMessage({ type: 'ERROR', fatal: true, message: `Échec du chargement du modèle : ${error.message}` })
        throw error
      })
    }
    return
  }

  if (event.data.type === 'PROCESS_SEGMENT') {
    // Le pool n'envoie ce message qu'après avoir reçu MODELS_READY de
    // ce worker : les modèles sont donc toujours prêts à ce stade.
    processOneSegment(event.data.segment, event.data.mode)
  }
}
