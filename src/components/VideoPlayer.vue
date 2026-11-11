<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { decodeAudioSegments } from '../audio/audio-decode.js'
import { runInferencePool } from '../workers/worker-pool.js'
import { computeFingerprint } from '../utils/fingerprint.js'
import { captureThumbnail } from '../utils/thumbnail.js'
import { formatClause, applyReadingTiming } from '../utils/subtitle-format.js'
import { getProcessedVideo, saveProcessedVideo } from '../db/subtitles-store.js'
import { useVideoHistory } from '../db/useVideoHistory.js'
import { toSrt, toVtt, downloadTextFile } from '../utils/subtitle-export.js'
import { READY_THRESHOLD_SECONDS, MODEL_DOWNLOAD_SIZE_LABEL } from '../audio/constants.js'
import AppIcon from './ui/AppIcon.vue'

// Langue de la vidéo : 'english' (transcription) ou 'translate'
// (traduction vers l'anglais). Mémorisée comme simple confort.
const SOURCE_MODE_STORAGE_KEY = 'sous-titreur:source-mode'

const { refresh: refreshHistory } = useVideoHistory()

const playerContainerRef = ref(null)
const videoRef = ref(null)
const videoSrc = ref(null)
const fileName = ref('')
const isDraggingOver = ref(false)
const isFullscreen = ref(false)

// 'idle' | 'processing' | 'ready' | 'error'
const status = ref('idle')
const errorMessage = ref('')
const subtitles = ref([])
const progress = ref({ done: 0, total: 0 })
const silenceSkippedSeconds = ref(0)
const activeSubtitleText = ref('')
const restoredFromCache = ref(false)

function readStoredSourceMode() {
  try {
    const stored = localStorage.getItem(SOURCE_MODE_STORAGE_KEY)
    return stored === 'translate' ? 'translate' : 'english'
  } catch {
    return 'english'
  }
}

const sourceMode = ref(readStoredSourceMode())

function setSourceMode(mode) {
  sourceMode.value = mode
  try {
    localStorage.setItem(SOURCE_MODE_STORAGE_KEY, mode)
  } catch {
    // Stockage indisponible (navigation privée...) : sans conséquence.
  }
}

function exportSubtitles(format) {
  const baseName = (fileName.value || 'sous-titres').replace(/\.[^.]+$/, '')
  if (format === 'srt') {
    downloadTextFile(toSrt(subtitles.value), `${baseName}.en.srt`, 'application/x-subrip')
  } else {
    downloadTextFile(toVtt(subtitles.value), `${baseName}.en.vtt`, 'text/vtt')
  }
}

// Phase affichée pendant status === 'processing'.
// 'decoding' | 'loading' | 'downloading' | 'generating'
const processingPhase = ref('decoding')
const modelDownloadProgress = ref(0)

// Déblocage progressif : la vidéo devient "regardable" dès qu'une
// portion suffisante (READY_THRESHOLD_SECONDS) est prête depuis le
// début, sans attendre la génération complète.
const playbackUnlocked = ref(false)
const readyUpToTime = ref(0)
const totalDuration = ref(0)
const showCatchUpPrompt = ref(false)

let objectUrl = null
let currentFile = null
let activePool = null
let currentFingerprint = null
let segmentsForProgress = []
let segmentDoneFlags = []
let bypassCatchUpCheck = false

function toggleVideoPlayback() {
  if (!videoRef.value) {
    return
  }
  if (videoRef.value.paused) {
    videoRef.value.play()
  } else {
    videoRef.value.pause()
  }
}

function onTimeUpdate() {
  if (!videoRef.value) {
    return
  }
  const currentTime = videoRef.value.currentTime
  const active = subtitles.value.find((s) => currentTime >= s.startTime && currentTime < s.endTime)
  activeSubtitleText.value = active ? active.text : ''

  const stillProcessing = status.value === 'processing'
  const pastReadyPoint = currentTime > readyUpToTime.value + 0.5
  const notFullyDone = readyUpToTime.value < totalDuration.value

  if (stillProcessing && !bypassCatchUpCheck && pastReadyPoint && notFullyDone) {
    videoRef.value.pause()
    showCatchUpPrompt.value = true
  }
}

function continueWithoutSubtitles() {
  bypassCatchUpCheck = true
  showCatchUpPrompt.value = false
  videoRef.value?.play()
}

function keepWaiting() {
  showCatchUpPrompt.value = false
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    playerContainerRef.value?.requestFullscreen?.()
  } else {
    document.exitFullscreen?.()
  }
}

function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === playerContainerRef.value
}

function recomputeReadyUpTo() {
  let i = 0
  while (i < segmentDoneFlags.length && segmentDoneFlags[i]) {
    i++
  }

  if (i === 0) {
    readyUpToTime.value = 0
  } else if (i === segmentDoneFlags.length) {
    readyUpToTime.value = totalDuration.value
  } else {
    readyUpToTime.value = segmentsForProgress[i - 1].endTime
  }

  if (!playbackUnlocked.value && readyUpToTime.value >= Math.min(READY_THRESHOLD_SECONDS, totalDuration.value)) {
    playbackUnlocked.value = true
  }

  if (showCatchUpPrompt.value && videoRef.value && readyUpToTime.value > videoRef.value.currentTime) {
    showCatchUpPrompt.value = false
    videoRef.value.play()
  }
}

async function checkCache(fingerprint) {
  const cached = await getProcessedVideo(fingerprint)
  if (!cached || fingerprint !== currentFingerprint) {
    return
  }
  subtitles.value = cached.subtitles
  status.value = 'ready'
  restoredFromCache.value = true

  try {
    await videoRef.value?.play()
  } catch (error) {
    console.warn('Lecture automatique refusée par le navigateur :', error.message)
  }
}

async function persistResult(fingerprint, file) {
  if (fingerprint !== currentFingerprint) {
    return
  }

  const thumbnailDataUrl = await captureThumbnail(objectUrl)

  await saveProcessedVideo({
    fingerprint,
    fileName: file.name,
    durationSeconds: videoRef.value?.duration || 0,
    sourceMode: sourceMode.value,
    subtitles: subtitles.value,
    thumbnailDataUrl,
    createdAt: Date.now()
  })

  await refreshHistory()
}

async function generateSubtitles() {
  if (!currentFile || status.value === 'processing') {
    return
  }

  status.value = 'processing'
  processingPhase.value = 'decoding'
  modelDownloadProgress.value = 0
  subtitles.value = []
  progress.value = { done: 0, total: 0 }
  restoredFromCache.value = false
  playbackUnlocked.value = false
  readyUpToTime.value = 0
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false

  const fingerprint = currentFingerprint
  const file = currentFile

  try {
    const { segments, totalDuration: duration, silenceSkippedSeconds: skipped } = await decodeAudioSegments(file)
    progress.value.total = segments.length
    silenceSkippedSeconds.value = skipped
    segmentsForProgress = segments
    segmentDoneFlags = new Array(segments.length).fill(false)
    totalDuration.value = duration

    processingPhase.value = 'loading'

    activePool = runInferencePool(segments, sourceMode.value, {
      onModelProgress: (percent) => {
        modelDownloadProgress.value = percent
        processingPhase.value = 'downloading'
      },
      onModelsReady: () => {
        processingPhase.value = 'generating'
      },
      onSubtitle: (subtitle) => {
        subtitles.value.push(...formatClause(subtitle))
        subtitles.value.sort((a, b) => a.startTime - b.startTime)
        applyReadingTiming(subtitles.value)
      },
      onSegmentDone: (segmentIndex) => {
        segmentDoneFlags[segmentIndex] = true
        progress.value = { done: progress.value.done + 1, total: progress.value.total }
        recomputeReadyUpTo()
      },
      onError: (message) => {
        console.error('Erreur du worker d\'inférence :', message)
      }
    })

    await activePool.promise
    status.value = 'ready'
    playbackUnlocked.value = true
    readyUpToTime.value = totalDuration.value
  } catch (error) {
    status.value = 'error'
    errorMessage.value = `Impossible de décoder l'audio de cette vidéo : ${error.message}`
    return
  }

  try {
    await persistResult(fingerprint, file)
  } catch (error) {
    console.warn('Sauvegarde du résultat dans IndexedDB impossible :', error.message)
  }
}

function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    console.warn('Fichier ignoré : ce n\'est pas une vidéo.', file?.type)
    return
  }

  if (activePool) {
    activePool.cancel()
    activePool = null
  }

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
  }

  objectUrl = URL.createObjectURL(file)
  currentFile = file
  currentFingerprint = computeFingerprint(file)
  videoSrc.value = objectUrl
  fileName.value = file.name
  subtitles.value = []
  status.value = 'idle'
  activeSubtitleText.value = ''
  restoredFromCache.value = false
  playbackUnlocked.value = false
  readyUpToTime.value = 0
  totalDuration.value = 0
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false

  checkCache(currentFingerprint)
}

function onFileInputChange(event) {
  loadFile(event.target.files[0])
}

function onDrop(event) {
  event.preventDefault()
  isDraggingOver.value = false
  loadFile(event.dataTransfer.files[0])
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (activePool) {
    activePool.cancel()
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      class="overflow-hidden rounded-2xl border bg-white shadow-card transition-colors"
      :class="isDraggingOver ? 'border-brand-500' : 'border-ink-200'"
      @dragover.prevent="isDraggingOver = true"
      @dragleave.prevent="isDraggingOver = false"
      @drop="onDrop"
    >
      <!-- Zone de dépôt -->
      <div
        v-if="!videoSrc"
        class="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center transition-colors"
        :class="isDraggingOver ? 'bg-brand-50' : 'bg-white'"
      >
        <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
          <AppIcon name="film" class="h-7 w-7" />
        </span>
        <div>
          <p class="text-lg font-semibold text-ink-900">Glissez une vidéo ici</p>
          <p class="mt-1 text-sm text-ink-500">MP4, MKV, WebM... Le fichier reste sur votre appareil.</p>
        </div>
        <label class="btn-primary cursor-pointer">
          Choisir un fichier
          <input type="file" accept="video/*" class="hidden" @change="onFileInputChange" />
        </label>
      </div>

      <!-- Lecteur -->
      <template v-else>
        <div ref="playerContainerRef" class="group relative bg-black">
          <video
            ref="videoRef"
            :src="videoSrc"
            controls
            controlsList="nofullscreen"
            class="block w-full bg-black"
            :class="isFullscreen ? 'h-screen object-contain' : 'max-h-[70vh]'"
            @timeupdate="onTimeUpdate"
            @click="toggleVideoPlayback"
          ></video>

          <div
            v-if="(status === 'ready' || playbackUnlocked) && activeSubtitleText"
            class="pointer-events-none absolute inset-x-0 bottom-[12%] flex justify-center px-6"
          >
            <p class="subtitle-overlay whitespace-pre-line bg-black px-3 py-1.5 text-center font-medium text-white">
              {{ activeSubtitleText }}
            </p>
          </div>

          <button
            class="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-black/50 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
            :aria-label="isFullscreen ? 'Quitter le plein écran' : 'Plein écran'"
            @click="toggleFullscreen"
          >
            <AppIcon :name="isFullscreen ? 'exitFullscreen' : 'fullscreen'" class="h-5 w-5" />
          </button>

          <div v-if="showCatchUpPrompt" class="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
            <div class="flex max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-card">
              <p class="text-sm text-ink-700">
                La suite n'est pas encore sous-titrée (génération en cours). Continuer la lecture sans sous-titres pour l'instant ?
              </p>
              <div class="flex justify-center gap-2">
                <button class="btn-secondary" @click="keepWaiting">Attendre</button>
                <button class="btn-primary" @click="continueWithoutSubtitles">Continuer sans sous-titres</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Barre d'état sous le lecteur -->
        <div class="flex flex-col gap-4 p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="truncate text-sm font-medium text-ink-900" :title="fileName">{{ fileName }}</p>
            <label class="cursor-pointer text-sm text-brand-600 hover:text-brand-700">
              Changer de vidéo
              <input type="file" accept="video/*" class="hidden" @change="onFileInputChange" />
            </label>
          </div>

          <!-- Prêt à générer -->
          <div v-if="status === 'idle'" class="flex flex-col gap-4 rounded-xl bg-ink-50 p-4">
            <div>
              <p class="text-sm font-medium text-ink-900">Langue parlée dans la vidéo</p>
              <div class="mt-2 inline-flex rounded-lg border border-ink-200 bg-white p-1" role="radiogroup" aria-label="Langue parlée dans la vidéo">
                <button
                  v-for="option in [{ value: 'english', label: 'Anglais' }, { value: 'translate', label: 'Autre langue (traduire en anglais)' }]"
                  :key="option.value"
                  role="radio"
                  :aria-checked="sourceMode === option.value"
                  class="rounded-md px-3 py-1.5 text-sm transition-colors"
                  :class="sourceMode === option.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
                  @click="setSourceMode(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <p class="text-sm text-ink-600">
              Les sous-titres sont générés en anglais, entièrement en local. Au premier usage, le modèle IA
              ({{ MODEL_DOWNLOAD_SIZE_LABEL }}) est téléchargé, puis conservé pour un usage hors ligne.
            </p>
            <button class="btn-primary self-start" @click="generateSubtitles">Générer les sous-titres</button>
          </div>

          <!-- Traitement en cours -->
          <div v-if="status === 'processing'" class="flex flex-col gap-3">
            <div v-if="playbackUnlocked" class="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
              <AppIcon name="check" class="h-5 w-5 flex-shrink-0 text-brand-600" />
              <span>Vous pouvez regarder dès maintenant : les sous-titres continuent de se générer en arrière-plan.</span>
            </div>

            <div class="flex flex-col gap-1.5">
              <p class="text-sm text-ink-700">
                <template v-if="processingPhase === 'decoding'">Décodage de la vidéo et détection de la parole...</template>
                <template v-else-if="processingPhase === 'loading'">Chargement du modèle IA...</template>
                <template v-else-if="processingPhase === 'downloading'">
                  Téléchargement du modèle IA
                  <span class="text-ink-500">({{ Math.round(modelDownloadProgress) }} %)</span>
                </template>
                <template v-else>
                  Génération des sous-titres
                  <span class="text-ink-500">({{ progress.total ? Math.round((progress.done / progress.total) * 100) : 0 }} %)</span>
                </template>
              </p>

              <div class="h-2 w-full overflow-hidden rounded-full bg-ink-100">
                <div
                  v-if="processingPhase === 'decoding' || processingPhase === 'loading'"
                  class="indeterminate-bar h-full w-1/3 rounded-full bg-brand-600"
                ></div>
                <div
                  v-else
                  class="h-full rounded-full bg-brand-600 transition-[width] duration-300"
                  :style="{ width: (processingPhase === 'downloading' ? Math.round(modelDownloadProgress) : Math.round((progress.done / (progress.total || 1)) * 100)) + '%' }"
                ></div>
              </div>

              <p v-if="processingPhase === 'downloading'" class="text-xs text-ink-500">
                Uniquement au premier usage : le modèle sera ensuite disponible hors ligne.
              </p>
              <p v-if="processingPhase === 'generating' && silenceSkippedSeconds > 1" class="text-xs text-ink-500">
                Environ {{ Math.round(silenceSkippedSeconds) }} s sans parole détectée (silence ou musique seule) ignorées.
              </p>
            </div>
          </div>

          <!-- Terminé -->
          <div v-if="status === 'ready'" class="flex flex-wrap items-center justify-between gap-3">
            <p class="flex items-center gap-2 text-sm text-ink-600">
              <AppIcon name="check" class="h-4 w-4 text-brand-600" />
              {{ restoredFromCache ? 'Sous-titres restaurés depuis le cache local.' : 'Sous-titres prêts.' }}
            </p>
            <div v-if="subtitles.length" class="flex gap-2">
              <button class="btn-secondary !px-3 !py-1.5" @click="exportSubtitles('srt')">
                <AppIcon name="download" class="h-4 w-4" /> .srt
              </button>
              <button class="btn-secondary !px-3 !py-1.5" @click="exportSubtitles('vtt')">
                <AppIcon name="download" class="h-4 w-4" /> .vtt
              </button>
            </div>
          </div>

          <p v-if="status === 'error'" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {{ errorMessage }}
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.subtitle-overlay {
  font-size: clamp(1rem, 2.2vw, 1.75rem);
  transition: opacity 0.15s ease;
}

.indeterminate-bar {
  animation: indeterminate-slide 1.2s ease-in-out infinite;
}

@keyframes indeterminate-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
</style>
