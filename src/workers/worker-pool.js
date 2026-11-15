// Répartit les segments audio entre plusieurs instances du worker
// d'inférence, pour paralléliser le calcul sur les cœurs disponibles.
//
// Le pool est incrémental : les segments arrivent au fil du décodage
// audio en flux (enqueue), et le pool continue de travailler tant que
// close() n'a pas été appelé. Chaque worker prend le segment en attente
// le plus ancien dès qu'il est libre : les segments sont donc complétés
// globalement dans l'ordre de la vidéo.
//
// Les workers ne sont créés qu'au premier segment : une vidéo sans
// parole (ou déjà entièrement traitée) ne déclenche aucun chargement de
// modèle. Chaque worker charge sa propre copie du modèle en mémoire, ce
// que MAX_WORKERS plafonne. Le premier worker démarre seul et remplit le
// cache navigateur avant que les autres ne démarrent : sans ce décalage,
// un premier lancement (cache vide) téléchargerait les mêmes poids en
// double, triple...

import { detectDevice } from '../utils/device.js'
const MAX_WORKERS = 3

function pickWorkerCount() {
  // Un seul worker sur un appareil limité : chaque worker charge sa propre
  // copie du modèle, ce qui épuise vite la mémoire d'un téléphone.
  if (detectDevice().limited) return 1
  const availableCores = navigator.hardwareConcurrency || 2
  return Math.max(1, Math.min(MAX_WORKERS, availableCores))
}

/**
 * @param {'english' | 'translate'} mode
 * @param {{
 *   onSubtitle: (segmentIndex: number, clause: object) => void,
 *   onSegmentDone: (segmentIndex: number) => void,
 *   onModelProgress: (percent: number) => void,
 *   onModelsReady: () => void,
 *   onError: (message: string) => void
 * }} callbacks
 * @returns {{
 *   enqueue: (segments: { index: number, audio: Float32Array, startTime: number, endTime: number }[]) => void,
 *   close: () => void,
 *   cancel: () => void,
 *   promise: Promise<void>
 * }}
 */
export function createInferencePool(mode, { onSubtitle, onSegmentDone, onModelProgress, onModelsReady, onError }) {
  const queue = []
  const workers = []
  const idle = []
  let busyCount = 0
  let started = false
  let closed = false
  let finished = false
  let modelsReadyNotified = false
  let resolvePromise
  let rejectPromise

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  function terminateAll() {
    workers.forEach((entry) => entry.worker.terminate())
  }

  function maybeFinish() {
    if (finished || !closed || queue.length > 0 || busyCount > 0) return
    finished = true
    terminateAll()
    resolvePromise()
  }

  function fail(message, code) {
    if (finished) return
    finished = true
    terminateAll()
    const error = new Error(message)
    error.code = code
    rejectPromise(error)
  }

  function dispatch() {
    while (queue.length > 0 && idle.length > 0) {
      const entry = idle.shift()
      const segment = queue.shift()
      entry.assignedIndex = segment.index
      busyCount++
      entry.worker.postMessage({ type: 'PROCESS_SEGMENT', segment, mode }, [segment.audio.buffer])
    }
    maybeFinish()
  }

  function start() {
    started = true
    const count = pickWorkerCount()
    let firstReadyResolve
    const firstReady = new Promise((resolve) => { firstReadyResolve = resolve })

    for (let w = 0; w < count; w++) {
      const worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' })
      const entry = { worker, assignedIndex: null }
      workers.push(entry)

      worker.onmessage = (event) => {
        const message = event.data

        if (message.type === 'MODEL_PROGRESS') {
          // Seul le premier worker télécharge réellement ; les autres
          // lisent le cache instantanément, leur progression est ignorée.
          if (w === 0) onModelProgress?.(message.percent)
        } else if (message.type === 'MODELS_READY') {
          if (w === 0) firstReadyResolve()
          if (!modelsReadyNotified) {
            modelsReadyNotified = true
            onModelsReady?.()
          }
          idle.push(entry)
          dispatch()
        } else if (message.type === 'SUBTITLE') {
          onSubtitle(entry.assignedIndex, {
            startTime: message.startTime,
            endTime: message.endTime,
            text: message.text,
            words: message.words
          })
        } else if (message.type === 'SEGMENT_DONE') {
          busyCount--
          onSegmentDone(entry.assignedIndex)
          entry.assignedIndex = null
          idle.push(entry)
          dispatch()
        } else if (message.type === 'ERROR') {
          if (message.fatal) {
            fail(message.message, message.code)
          } else {
            onError?.(message.message)
          }
        }
      }

      if (w === 0) {
        worker.postMessage({ type: 'START_LOADING' })
      } else {
        firstReady.then(() => worker.postMessage({ type: 'START_LOADING' }))
      }
    }
  }

  return {
    promise,
    enqueue(segments) {
      if (finished || segments.length === 0) return
      queue.push(...segments)
      if (!started) start()
      dispatch()
    },
    close() {
      closed = true
      maybeFinish()
    },
    cancel() {
      if (finished) return
      finished = true
      terminateAll()
      resolvePromise()
    }
  }
}
