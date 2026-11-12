// Orchestre la génération des sous-titres : décodage audio en flux,
// pool de workers Whisper, nettoyage, reprise après interruption,
// progression et temps restant estimé.
//
// Le composant vidéo ne s'occupe que de la lecture et de l'affichage ;
// tout l'état de la génération vit ici.

import { ref, computed } from 'vue'
import { streamAudioSegments } from '../audio/audio-stream.js'
import { createInferencePool } from '../workers/worker-pool.js'
import { formatClause, applyReadingTiming } from '../utils/subtitle-format.js'
import { cleanSubtitles } from '../utils/hallucination-filter.js'
import {
  getPartialProgress,
  savePartialProgress,
  deletePartialProgress,
  partialKey
} from '../db/subtitles-store.js'
import { READY_THRESHOLD_SECONDS } from '../audio/constants.js'

const PARTIAL_SAVE_INTERVAL_MS = 5000
const ETA_MIN_ELAPSED_MS = 20000
const ETA_MIN_PROGRESS_FRACTION = 0.02
// Tolérance sur le début d'un segment pour valider qu'un segment
// sauvegardé correspond bien à celui re-détecté à la reprise.
const RESUME_START_TOLERANCE_SECONDS = 0.05

export function useSubtitleGeneration() {
  // 'idle' | 'processing' | 'ready' | 'error'
  const status = ref('idle')
  const errorMessage = ref('')
  // 'decoding' | 'loading' | 'downloading' | 'generating'
  const processingPhase = ref('decoding')
  const modelDownloadProgress = ref(0)
  const subtitles = ref([])
  const readyUpToTime = ref(0)
  const totalDuration = ref(0)
  const playbackUnlocked = ref(false)
  const silenceSkippedSeconds = ref(0)
  const etaSeconds = ref(null)
  // Progression d'un traitement interrompu retrouvé : { percent } | null
  const partialInfo = ref(null)

  const progressPercent = computed(() => {
    if (totalDuration.value <= 0) return 0
    return Math.min(100, Math.round((readyUpToTime.value / totalDuration.value) * 100))
  })

  // --- État interne d'une exécution ---
  let runId = 0
  let abortController = null
  let pool = null
  let registry = []            // un élément par segment, dans l'ordre : { startTime, endTime, done }
  let blocksBySegment = new Map()
  let doneSegments = new Map()
  let contiguousDone = 0
  let horizon = 0
  let generationStartedAt = 0
  let readyAtGenerationStart = 0
  let lastPartialSave = 0
  let storageKey = null

  function resetRunState() {
    registry = []
    blocksBySegment = new Map()
    doneSegments = new Map()
    contiguousDone = 0
    horizon = 0
    generationStartedAt = 0
    readyAtGenerationStart = 0
    lastPartialSave = 0
    pool = null
    subtitles.value = []
    readyUpToTime.value = 0
    totalDuration.value = 0
    playbackUnlocked.value = false
    silenceSkippedSeconds.value = 0
    etaSeconds.value = null
    modelDownloadProgress.value = 0
    processingPhase.value = 'decoding'
    errorMessage.value = ''
  }

  function rebuildSubtitles() {
    const all = []
    for (const entry of blocksBySegment.values()) {
      for (const block of entry.blocks) all.push({ ...block })
    }
    all.sort((a, b) => a.startTime - b.startTime)
    const cleaned = cleanSubtitles(all)
    applyReadingTiming(cleaned)
    subtitles.value = cleaned
  }

  function recomputeReady() {
    while (contiguousDone < registry.length && registry[contiguousDone].done) {
      contiguousDone++
    }
    const candidate = contiguousDone < registry.length ? registry[contiguousDone].startTime : horizon
    readyUpToTime.value = Math.max(readyUpToTime.value, candidate)

    const threshold = Math.min(READY_THRESHOLD_SECONDS, totalDuration.value || READY_THRESHOLD_SECONDS)
    if (!playbackUnlocked.value && readyUpToTime.value >= threshold) {
      playbackUnlocked.value = true
    }

    updateEta()
  }

  function updateEta() {
    if (!generationStartedAt || totalDuration.value <= 0) return
    const elapsedMs = Date.now() - generationStartedAt
    const progressed = (readyUpToTime.value - readyAtGenerationStart) / totalDuration.value
    if (elapsedMs < ETA_MIN_ELAPSED_MS || progressed < ETA_MIN_PROGRESS_FRACTION) return

    const remaining = (totalDuration.value - readyUpToTime.value) / totalDuration.value
    etaSeconds.value = Math.max(0, Math.round((remaining / progressed) * (elapsedMs / 1000)))
  }

  function ensureEntry(index) {
    let entry = blocksBySegment.get(index)
    if (!entry) {
      const segment = registry[index]
      entry = { index, startTime: segment.startTime, endTime: segment.endTime, blocks: [] }
      blocksBySegment.set(index, entry)
    }
    return entry
  }

  function maybeSavePartial(force = false) {
    if (!storageKey) return
    const now = Date.now()
    if (!force && now - lastPartialSave < PARTIAL_SAVE_INTERVAL_MS) return
    lastPartialSave = now
    savePartialProgress(storageKey, [...doneSegments.values()]).catch((error) => {
      console.warn('Sauvegarde de la progression impossible :', error.message)
    })
  }

  function createPool(runToken, mode) {
    const isStale = () => runToken !== runId
    processingPhase.value = 'loading'

    return createInferencePool(mode, {
      onModelProgress: (percent) => {
        if (isStale()) return
        modelDownloadProgress.value = percent
        processingPhase.value = 'downloading'
      },
      onModelsReady: () => {
        if (isStale()) return
        processingPhase.value = 'generating'
        generationStartedAt = Date.now()
        readyAtGenerationStart = readyUpToTime.value
      },
      onSubtitle: (index, clause) => {
        if (isStale()) return
        ensureEntry(index).blocks.push(...formatClause(clause))
      },
      onSegmentDone: (index) => {
        if (isStale()) return
        registry[index].done = true
        const entry = ensureEntry(index)
        doneSegments.set(index, { ...entry })
        rebuildSubtitles()
        recomputeReady()
        maybeSavePartial()
      },
      onError: (message) => console.error("Erreur du worker d'inférence :", message)
    })
  }

  /**
   * Cherche une progression interrompue pour cette vidéo et ce mode.
   */
  async function checkPartial(fingerprint, mode, videoDuration) {
    partialInfo.value = null
    try {
      const partial = await getPartialProgress(partialKey(fingerprint, mode))
      if (!partial || partial.segments.length === 0) return
      const covered = Math.max(...partial.segments.map((s) => s.endTime))
      const percent = videoDuration > 0 ? Math.min(99, Math.round((covered / videoDuration) * 100)) : 0
      partialInfo.value = { percent }
    } catch (error) {
      console.warn('Lecture de la progression sauvegardée impossible :', error.message)
    }
  }

  /**
   * Lance (ou reprend) la génération. Résout avec la liste finale de
   * sous-titres ; rejette en cas d'erreur fatale. Résout avec null si
   * la génération a été annulée.
   */
  async function start(file, { fingerprint, mode, durationHint }) {
    cancel()
    resetRunState()
    const runToken = ++runId
    abortController = new AbortController()
    const signal = abortController.signal
    storageKey = partialKey(fingerprint, mode)
    status.value = 'processing'
    partialInfo.value = null
    if (Number.isFinite(durationHint) && durationHint > 0) {
      totalDuration.value = durationHint
    }

    let resumeMap = new Map()
    try {
      const partial = await getPartialProgress(storageKey)
      if (partial) resumeMap = new Map(partial.segments.map((s) => [s.index, s]))
    } catch (error) {
      console.warn('Lecture de la progression sauvegardée impossible :', error.message)
    }

    let fatalError = null
    try {
      let nextIndex = 0

      for await (const chunk of streamAudioSegments(file, { durationHint, signal })) {
        if (runToken !== runId) return null

        const toProcess = []
        for (const segment of chunk.segments) {
          const index = nextIndex++
          const stored = resumeMap.get(index)
          const matches = stored && Math.abs(stored.startTime - segment.startTime) < RESUME_START_TOLERANCE_SECONDS

          registry.push({ startTime: segment.startTime, endTime: segment.endTime, done: Boolean(matches) })

          if (matches) {
            blocksBySegment.set(index, { ...stored })
            doneSegments.set(index, { ...stored })
          } else {
            toProcess.push({ index, ...segment })
          }
        }

        horizon = chunk.horizon
        silenceSkippedSeconds.value += Math.max(0, chunk.analyzedSeconds - chunk.speechSeconds)

        if (toProcess.length > 0) {
          if (!pool) {
            pool = createPool(runToken, mode)
            pool.promise.catch((error) => {
              fatalError = error
              abortController?.abort()
            })
          }
          pool.enqueue(toProcess)
        }

        rebuildSubtitles()
        recomputeReady()
      }

      if (fatalError) throw fatalError
      if (runToken !== runId) return null

      if (pool) {
        pool.close()
        await pool.promise
      }
      if (runToken !== runId) return null

      if (!(totalDuration.value > 0)) totalDuration.value = horizon
      readyUpToTime.value = totalDuration.value
      playbackUnlocked.value = true
      etaSeconds.value = null
      status.value = 'ready'

      deletePartialProgress(storageKey).catch(() => {})
      return subtitles.value
    } catch (error) {
      if (runToken !== runId) return null
      maybeSavePartial(true)
      status.value = 'error'
      errorMessage.value = (fatalError || error).message
      throw fatalError || error
    }
  }

  function cancel() {
    runId++
    abortController?.abort()
    abortController = null
    pool?.cancel()
    pool = null
  }

  function restoreFromCache(entry) {
    cancel()
    resetRunState()
    subtitles.value = entry.subtitles
    totalDuration.value = entry.durationSeconds || 0
    readyUpToTime.value = totalDuration.value
    playbackUnlocked.value = true
    status.value = 'ready'
  }

  function reset() {
    cancel()
    resetRunState()
    partialInfo.value = null
    status.value = 'idle'
  }

  return {
    status,
    errorMessage,
    processingPhase,
    modelDownloadProgress,
    subtitles,
    readyUpToTime,
    totalDuration,
    playbackUnlocked,
    silenceSkippedSeconds,
    etaSeconds,
    progressPercent,
    partialInfo,
    start,
    cancel,
    reset,
    restoreFromCache,
    checkPartial
  }
}
