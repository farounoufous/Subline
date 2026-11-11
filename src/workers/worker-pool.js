// Répartit les segments audio entre plusieurs instances du worker
// d'inférence, pour paralléliser le calcul sur les cœurs disponibles.
//
// Contrairement à une répartition en tranches fixes par worker, chaque
// worker demande ici son prochain segment dès qu'il est libre, et le
// pool lui donne toujours le segment chronologiquement le plus proche
// du début pas encore assigné. Résultat : les segments sont complétés
// globalement dans l'ordre de la vidéo, ce qui permet de savoir à tout
// moment jusqu'à quel instant la vidéo est prête, sans attendre qu'elle
// le soit en entier.
//
// Compromis assumé : chaque worker charge sa propre copie complète des
// modèles en mémoire (plusieurs centaines de Mo par worker). Plus de
// workers en parallèle veut dire un gain de vitesse potentiel, mais
// aussi plus de RAM utilisée — MAX_WORKERS plafonne ce compromis.
//
// Le premier worker démarre seul et remplit le cache navigateur avant
// que les autres ne démarrent à leur tour (voir plus bas) : sans ce
// décalage, un premier lancement (cache vide) déclenche un
// téléchargement des mêmes poids en double, triple, etc. selon le
// nombre de workers, puisqu'aucun n'a encore fini d'écrire le cache
// quand les autres démarrent leur propre chargement.

const MAX_WORKERS = 3

function pickWorkerCount(segmentCount) {
  const availableCores = navigator.hardwareConcurrency || 2
  return Math.max(1, Math.min(MAX_WORKERS, availableCores, segmentCount))
}

/**
 * Lance l'inférence sur tous les segments en répartissant le travail
 * entre plusieurs workers, dans l'ordre chronologique. Les callbacks
 * sont appelés au fil de l'eau, au fur et à mesure que chaque worker
 * avance.
 *
 * @param {{ audio: Float32Array, startTime: number, endTime: number }[]} segments
 * @param {'english' | 'translate'} mode  'english' : transcription ; 'translate' : traduction vers l'anglais
 * @param {{
 *   onSubtitle: (subtitle: { startTime: number, endTime: number, text: string, words: object[] }) => void,
 *   onSegmentDone: (segmentIndex: number) => void,
 *   onModelProgress: (percent: number) => void,
 *   onModelsReady: () => void,
 *   onError: (message: string) => void
 * }} callbacks
 * @returns {{ promise: Promise<void>, cancel: () => void }}
 */
export function runInferencePool(segments, mode, { onSubtitle, onSegmentDone, onModelProgress, onModelsReady, onError }) {
  const workerCount = pickWorkerCount(segments.length)
  const workers = []

  let nextIndex = 0
  let finishedWorkers = 0
  let modelsReadyNotified = false

  const promise = new Promise((resolve) => {
    let firstWorkerReadyResolve
    const firstWorkerReady = new Promise((res) => { firstWorkerReadyResolve = res })

    for (let w = 0; w < workerCount; w++) {
      const worker = new Worker(new URL('./inference-worker.js', import.meta.url), {
        type: 'module'
      })
      workers.push(worker)

      // Index du segment actuellement confié à CE worker, pour savoir
      // à qui appartient un SEGMENT_DONE quand il arrive.
      let assignedIndex = null

      function assignNext() {
        if (nextIndex >= segments.length) {
          worker.terminate()
          finishedWorkers++
          if (finishedWorkers === workerCount) {
            resolve()
          }
          return
        }

        assignedIndex = nextIndex
        const segment = segments[nextIndex]
        nextIndex++

        worker.postMessage(
          { type: 'PROCESS_SEGMENT', segment, mode },
          [segment.audio.buffer]
        )
      }

      worker.onmessage = (event) => {
        const message = event.data

        if (message.type === 'MODEL_PROGRESS') {
          // Seul le premier worker télécharge réellement (les suivants
          // attendent son cache) : on ignore la progression des autres,
          // qui ne reflète qu'une lecture instantanée depuis le cache.
          if (w === 0 && onModelProgress) {
            onModelProgress(message.percent)
          }
        } else if (message.type === 'MODELS_READY') {
          if (w === 0) {
            firstWorkerReadyResolve()
          }
          if (!modelsReadyNotified) {
            modelsReadyNotified = true
            onModelsReady?.()
          }
          assignNext()
        } else if (message.type === 'SUBTITLE') {
          onSubtitle({ startTime: message.startTime, endTime: message.endTime, text: message.text, words: message.words })
        } else if (message.type === 'SEGMENT_DONE') {
          onSegmentDone(assignedIndex)
          assignNext()
        } else if (message.type === 'ERROR') {
          onError(message.message)
        }
      }

      if (w === 0) {
        worker.postMessage({ type: 'START_LOADING' })
      } else {
        firstWorkerReady.then(() => worker.postMessage({ type: 'START_LOADING' }))
      }
    }
  })

  function cancel() {
    workers.forEach((worker) => worker.terminate())
  }

  return { promise, cancel }
}
