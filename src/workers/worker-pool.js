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

// Contre-pression : le décodage audio et le VAD vont bien plus vite que
// Whisper. Sans limite, tout l'audio d'un long film s'empilerait en
// mémoire (64 Ko par seconde de parole). Le producteur attend donc que
// la file repasse sous ce nombre de segments avant de décoder la suite.
// La limite porte sur la file d'attente, et le décodage avance par lots :
// la file peut donc dépasser brièvement ce nombre d'un lot (~5 min d'audio).
const MAX_QUEUED_SEGMENTS = 8

// Nombre maximal de remplacements de workers bloqués avant d'abandonner.
const MAX_WORKER_REPLACEMENTS = 3

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
 *   onSegmentDone: (segmentIndex: number, result: { failed: boolean }) => void,
 *   onModelProgress: (percent: number) => void,
 *   onModelsReady: () => void,
 *   onError: (message: string) => void
 * }} callbacks
 * @returns {{
 *   enqueue: (segments: { index: number, audio: Float32Array, startTime: number, endTime: number }[]) => void,
 *   waitForRoom: () => Promise<void>,
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
  let roomWaiters = []
  let replacements = 0
  let resolvePromise
  let rejectPromise

  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  function releaseWaiters(force = false) {
    if (!force && queue.length > MAX_QUEUED_SEGMENTS) return
    const waiters = roomWaiters
    roomWaiters = []
    waiters.forEach((resolve) => resolve())
  }

  function terminateAll() {
    releaseWaiters(true)
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
    releaseWaiters()
    maybeFinish()
  }

  // Crée un worker. `leader` : le premier worker télécharge les modèles ;
  // les autres (et les remplaçants) les lisent ensuite depuis le cache.
  function spawnWorker(leader, loadAfter) {
    const worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' })
    const entry = { worker, assignedIndex: null, retired: false }
    workers.push(entry)

    worker.onmessage = (event) => {
      if (entry.retired) return
      const message = event.data

      if (message.type === 'MODEL_PROGRESS') {
        // Seul le premier worker télécharge réellement ; les autres
        // lisent le cache instantanément, leur progression est ignorée.
        if (leader) onModelProgress?.(message.percent)
      } else if (message.type === 'MODELS_READY') {
        if (leader) firstReadyResolve?.()
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
        onSegmentDone(entry.assignedIndex, { failed: Boolean(message.failed) })
        entry.assignedIndex = null
        if (message.stuck) {
          replaceWorker(entry)
        } else {
          idle.push(entry)
          dispatch()
        }
      } else if (message.type === 'ERROR') {
        if (message.fatal) {
          fail(message.message, message.code)
        } else {
          onError?.(message.message)
        }
      }
    }

    if (loadAfter) loadAfter.then(() => worker.postMessage({ type: 'START_LOADING' }))
    else worker.postMessage({ type: 'START_LOADING' })
    return entry
  }

  // Un délai d'inférence dépassé laisse le calcul d'origine tourner dans le
  // worker, sur une session qui n'accepte pas deux exécutions simultanées :
  // les segments suivants échoueraient en cascade. On le remplace par un
  // worker neuf (modèles lus depuis le cache navigateur).
  function replaceWorker(entry) {
    entry.retired = true
    entry.worker.terminate()
    const position = workers.indexOf(entry)
    if (position >= 0) workers.splice(position, 1)

    if (finished) return
    replacements++
    if (replacements > MAX_WORKER_REPLACEMENTS) {
      fail('Le moteur local ne répond plus. Relance la génération pour reprendre.', 'stuck')
      return
    }
    spawnWorker(false, null)
  }

  let firstReadyResolve = null

  function start() {
    started = true
    const count = pickWorkerCount()
    const firstReady = new Promise((resolve) => { firstReadyResolve = resolve })
    for (let w = 0; w < count; w++) {
      spawnWorker(w === 0, w === 0 ? null : firstReady)
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
    // Résout quand la file est assez courte pour décoder la suite.
    waitForRoom() {
      if (finished || queue.length <= MAX_QUEUED_SEGMENTS) return Promise.resolve()
      return new Promise((resolve) => roomWaiters.push(resolve))
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
