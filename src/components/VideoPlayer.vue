<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { computeFingerprint } from '../utils/fingerprint.js'
import { captureThumbnail } from '../utils/thumbnail.js'
import { toSrt, toVtt, downloadTextFile } from '../utils/subtitle-export.js'
import { getProcessedVideo, saveProcessedVideo } from '../db/subtitles-store.js'
import { useVideoHistory } from '../db/useVideoHistory.js'
import { useSubtitleGeneration } from '../composables/useSubtitleGeneration.js'
import { MODEL_DOWNLOAD_SIZE_LABEL } from '../audio/constants.js'
import AppIcon from './ui/AppIcon.vue'
import TranscriptPanel from './TranscriptPanel.vue'

// Langue de la vidéo : 'english' (transcription) ou 'translate'
// (traduction vers l'anglais). Mémorisée comme simple confort.
const SOURCE_MODE_STORAGE_KEY = 'subline:source-mode'
const SOURCE_OPTIONS = [
  { value: 'english', label: 'Anglais' },
  { value: 'translate', label: 'Autre langue (traduire en anglais)' }
]

const { refresh: refreshHistory } = useVideoHistory()
const generation = useSubtitleGeneration()
const {
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
  partialInfo
} = generation

const playerContainerRef = ref(null)
const videoRef = ref(null)
const videoSrc = ref(null)
const fileName = ref('')
const isDraggingOver = ref(false)
const isFullscreen = ref(false)
const restoredFromCache = ref(false)
const showCatchUpPrompt = ref(false)

const activeIndex = ref(-1)
const activeSubtitleText = ref('')
// Décalage manuel de l'affichage des sous-titres (secondes).
const subtitleOffset = ref(0)

function readStoredSourceMode() {
  try {
    return localStorage.getItem(SOURCE_MODE_STORAGE_KEY) === 'translate' ? 'translate' : 'english'
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

let objectUrl = null
let currentFile = null
let currentFingerprint = null
let bypassCatchUpCheck = false

// --- Lecture et sous-titre actif ---

function toggleVideoPlayback() {
  if (!videoRef.value) return
  if (videoRef.value.paused) {
    videoRef.value.play()
  } else {
    videoRef.value.pause()
  }
}

function updateActiveSubtitle() {
  if (!videoRef.value) return
  const time = videoRef.value.currentTime - subtitleOffset.value
  const index = subtitles.value.findIndex((s) => time >= s.startTime && time < s.endTime)
  activeIndex.value = index
  activeSubtitleText.value = index >= 0 ? subtitles.value[index].text : ''
}

function onTimeUpdate() {
  if (!videoRef.value) return
  updateActiveSubtitle()

  const pastReadyPoint = videoRef.value.currentTime > readyUpToTime.value + 0.5
  const notFullyDone = readyUpToTime.value < totalDuration.value

  if (status.value === 'processing' && !bypassCatchUpCheck && pastReadyPoint && notFullyDone) {
    videoRef.value.pause()
    showCatchUpPrompt.value = true
  }
}

function seekToSubtitle(subtitle) {
  if (!videoRef.value) return
  videoRef.value.currentTime = Math.max(0, subtitle.startTime + subtitleOffset.value)
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

// Reprise automatique de la lecture quand la génération rattrape le
// point de lecture après une pause d'attente.
watch(readyUpToTime, (ready) => {
  if (showCatchUpPrompt.value && videoRef.value && ready > videoRef.value.currentTime) {
    showCatchUpPrompt.value = false
    videoRef.value.play()
  }
})

watch(subtitleOffset, updateActiveSubtitle)
watch(subtitles, updateActiveSubtitle)

// --- Export ---

function exportSubtitles(format) {
  const shifted = subtitles.value.map((s) => ({
    ...s,
    startTime: Math.max(0, s.startTime + subtitleOffset.value),
    endTime: Math.max(0, s.endTime + subtitleOffset.value)
  }))
  const baseName = (fileName.value || 'subline').replace(/\.[^.]+$/, '')

  if (format === 'srt') {
    downloadTextFile(toSrt(shifted), `${baseName}.en.srt`, 'application/x-subrip')
  } else {
    downloadTextFile(toVtt(shifted), `${baseName}.en.vtt`, 'text/vtt')
  }
}

// --- Cache et génération ---

async function checkCache(fingerprint) {
  const cached = await getProcessedVideo(fingerprint)
  if (!cached || fingerprint !== currentFingerprint) return

  generation.restoreFromCache(cached)
  restoredFromCache.value = true

  try {
    await videoRef.value?.play()
  } catch (error) {
    console.warn('Lecture automatique refusée par le navigateur :', error.message)
  }
}

async function persistResult(fingerprint, file) {
  if (fingerprint !== currentFingerprint) return

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

async function refreshPartialInfo() {
  if (!currentFingerprint || status.value !== 'idle') return
  await generation.checkPartial(currentFingerprint, sourceMode.value, videoRef.value?.duration || 0)
}

function onLoadedMetadata() {
  refreshPartialInfo()
}

watch(sourceMode, refreshPartialInfo)

async function generateSubtitles() {
  if (!currentFile || status.value === 'processing') return

  restoredFromCache.value = false
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false

  const fingerprint = currentFingerprint
  const file = currentFile

  try {
    const result = await generation.start(file, {
      fingerprint,
      mode: sourceMode.value,
      durationHint: videoRef.value?.duration
    })
    if (result === null) return // annulée (autre vidéo chargée)
  } catch (error) {
    console.error('Échec de la génération :', error)
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
    console.warn("Fichier ignoré : ce n'est pas une vidéo.", file?.type)
    return
  }

  generation.reset()
  if (objectUrl) URL.revokeObjectURL(objectUrl)

  objectUrl = URL.createObjectURL(file)
  currentFile = file
  currentFingerprint = computeFingerprint(file)
  videoSrc.value = objectUrl
  fileName.value = file.name
  activeIndex.value = -1
  activeSubtitleText.value = ''
  restoredFromCache.value = false
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false
  subtitleOffset.value = 0

  checkCache(currentFingerprint)
}

function onFileInputChange(event) {
  loadFile(event.target.files[0])
  event.target.value = ''
}

function onDrop(event) {
  event.preventDefault()
  isDraggingOver.value = false
  loadFile(event.dataTransfer.files[0])
}

function formatEta(seconds) {
  if (seconds === null || seconds === undefined) return ''
  if (seconds < 60) return "moins d'une minute"
  return `environ ${Math.round(seconds / 60)} min`
}

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  generation.cancel()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div class="grid gap-6" :class="videoSrc ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''">
    <div
      class="self-start overflow-hidden rounded-2xl border bg-white shadow-card transition-colors"
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
            @loadedmetadata="onLoadedMetadata"
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
                  v-for="option in SOURCE_OPTIONS"
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
            <p v-if="partialInfo" class="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
              Une génération interrompue a été retrouvée ({{ partialInfo.percent }} % déjà traité). Elle sera reprise là où elle s'est arrêtée.
            </p>
            <button class="btn-primary self-start" @click="generateSubtitles">
              {{ partialInfo ? 'Reprendre la génération' : 'Générer les sous-titres' }}
            </button>
          </div>

          <!-- Traitement en cours -->
          <div v-if="status === 'processing'" class="flex flex-col gap-3">
            <div v-if="playbackUnlocked" class="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
              <AppIcon name="check" class="h-5 w-5 flex-shrink-0 text-brand-600" />
              <span>Vous pouvez regarder dès maintenant : les sous-titres continuent de se générer en arrière-plan.</span>
            </div>

            <div class="flex flex-col gap-1.5">
              <p class="text-sm text-ink-700">
                <template v-if="processingPhase === 'decoding'">Préparation de l'audio et détection de la parole...</template>
                <template v-else-if="processingPhase === 'loading'">Chargement du modèle IA...</template>
                <template v-else-if="processingPhase === 'downloading'">
                  Téléchargement du modèle IA
                  <span class="text-ink-500">({{ Math.round(modelDownloadProgress) }} %)</span>
                </template>
                <template v-else>
                  Génération des sous-titres
                  <span class="text-ink-500">
                    ({{ progressPercent }} %<template v-if="etaSeconds !== null"> &middot; {{ formatEta(etaSeconds) }} restantes</template>)
                  </span>
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
                  :style="{ width: (processingPhase === 'downloading' ? Math.round(modelDownloadProgress) : progressPercent) + '%' }"
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
              {{ !subtitles.length ? 'Aucune parole détectée dans cette vidéo.' : restoredFromCache ? 'Sous-titres restaurés depuis le cache local.' : 'Sous-titres prêts.' }}
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

    <TranscriptPanel
      v-if="videoSrc"
      v-model:offset="subtitleOffset"
      :subtitles="subtitles"
      :active-index="activeIndex"
      @seek="seekToSubtitle"
    />
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
