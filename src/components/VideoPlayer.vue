<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { captureThumbnail } from '../utils/thumbnail.js'
import { toSrt, toVtt, downloadTextFile } from '../utils/subtitle-export.js'
import { mediaKind, PICKER_TYPES, FILE_INPUT_ACCEPT } from '../utils/media-file.js'
import { getProcessedVideo, saveProcessedVideo, subtitleCacheKey } from '../db/subtitles-store.js'
import { useVideoHistory } from '../db/useVideoHistory.js'
import { useQueue } from '../db/useQueue.js'
import { useSubtitleGeneration } from '../composables/useSubtitleGeneration.js'
import { probeSubtitleTracks } from '../audio/embedded-subtitles.js'
import { network } from '../online/network.js'
import { quota } from '../online/quota.js'
import { formatMegabytes } from '../utils/format-bytes.js'
import { isTouchDevice } from '../utils/device.js'
import { t, locale } from '../i18n/index.js'
import { generateOutline } from '../online/summary.js'
import AppIcon from './ui/AppIcon.vue'
import TranscriptPanel from './TranscriptPanel.vue'
import GenerationPanel from './GenerationPanel.vue'
import QueuePanel from './QueuePanel.vue'
import OutlinePanel from './OutlinePanel.vue'

const CACHED_LANGUAGES = ['en', 'fr', 'mixed']
const POSITION_KEY_PREFIX = 'subline:position:'
const POSITION_SAVE_INTERVAL_MS = 2000
// Erreurs qui rendraient inutile de continuer la file avec les fichiers suivants.
const QUEUE_STOPPING_ERRORS = ['quota', 'auth', 'network']

const { refresh: refreshHistory } = useVideoHistory()
const queue = useQueue()
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
  partialInfo,
  engine,
  errorKind,
  outputLanguage,
  failedSegments,
  canContinueLocally
} = generation

const playerContainerRef = ref(null)
const videoRef = ref(null)
const fileInputRef = ref(null)
const videoSrc = ref(null)
const fileName = ref('')
const currentKind = ref('video')
const currentFile = ref(null)
const isDraggingOver = ref(false)
// Appareil tactile : on propose de choisir plutôt que de glisser.
const touchDevice = isTouchDevice()
// iOS Safari ne sait pas mettre un <div> en plein écran : on laisse alors
// le plein écran natif du lecteur (les sous-titres y disparaissent, faute de mieux).
const canFullscreenContainer = typeof document !== 'undefined' && Boolean(document.fullscreenEnabled)
const isFullscreen = ref(false)
const restoredFromCache = ref(false)
const showCatchUpPrompt = ref(false)
const dropNotice = ref('')
const queueRunning = ref(false)
// Durée du média, réactive (l'élément <video> ne l'est pas).
const videoDuration = ref(0)

// --- Résumé et chapitres ---
const rightTab = ref('transcript')
const outline = ref(null)
const outlineBusy = ref(false)
const outlineProgress = ref({ done: 0, total: 0 })
const outlineError = ref('')
const playhead = ref(0)
let outlineController = null

const activeIndex = ref(-1)
const activeSubtitleText = ref('')
// Décalage manuel de l'affichage des sous-titres (secondes).
const subtitleOffset = ref(0)

// Sélection courante du panneau de génération (pour chercher la bonne
// progression interrompue) et derniers paramètres, pour pouvoir réessayer.
let currentPartialMode = 'english'
let lastOptions = null
// Dernière clé utilisée (réactive) : évite de la ressaisir pour le résumé.
const lastApiKey = ref('')

let objectUrl = null
let currentFingerprint = null
let bypassCatchUpCheck = false
let stopRequested = false
let metadataWaiter = null
let lastPositionSave = 0

const isAudio = computed(() => currentKind.value === 'audio')
// Élément de la file affiché mais dont le fichier n'est pas (encore) ouvert.
const pendingRestore = computed(() => {
  if (videoSrc.value || !queue.currentId.value) return null
  return queue.items.value.find((item) => item.id === queue.currentId.value) || null
})
const queueToProcess = computed(() => queue.items.value.filter((item) => item.status !== 'done' && queue.hasFile(item.id)).length)

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
  playhead.value = videoRef.value.currentTime
  const time = videoRef.value.currentTime - subtitleOffset.value
  const index = subtitles.value.findIndex((s) => time >= s.startTime && time < s.endTime)
  activeIndex.value = index
  activeSubtitleText.value = index >= 0 ? subtitles.value[index].text : ''
}

function savePosition() {
  const id = queue.currentId.value
  if (!id || !videoRef.value) return
  try {
    localStorage.setItem(POSITION_KEY_PREFIX + id, String(Math.floor(videoRef.value.currentTime)))
  } catch {
    // Sans conséquence.
  }
}

function readPosition(id) {
  try {
    return Number(localStorage.getItem(POSITION_KEY_PREFIX + id)) || 0
  } catch {
    return 0
  }
}

function onTimeUpdate() {
  if (!videoRef.value) return
  updateActiveSubtitle()

  if (Date.now() - lastPositionSave > POSITION_SAVE_INTERVAL_MS) {
    lastPositionSave = Date.now()
    savePosition()
  }

  const pastReadyPoint = videoRef.value.currentTime > readyUpToTime.value + 0.5
  const notFullyDone = readyUpToTime.value < totalDuration.value

  if (status.value === 'processing' && !queueRunning.value && !bypassCatchUpCheck && pastReadyPoint && notFullyDone) {
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
  const languageCode = outputLanguage.value === 'fr' ? 'fr' : 'en'

  if (format === 'srt') {
    downloadTextFile(toSrt(shifted), `${baseName}.${languageCode}.srt`, 'application/x-subrip')
  } else {
    downloadTextFile(toVtt(shifted), `${baseName}.${languageCode}.vtt`, 'text/vtt')
  }
}

// --- Cache et génération ---

async function checkCache(fingerprint) {
  // Plusieurs langues peuvent exister pour un même fichier : on restaure
  // la plus récente.
  const candidates = await Promise.all(
    CACHED_LANGUAGES.map((language) => getProcessedVideo(subtitleCacheKey(fingerprint, language)))
  )
  const cached = candidates.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!cached || fingerprint !== currentFingerprint) return

  generation.restoreFromCache(cached)
  outline.value = cached.outline || null
  restoredFromCache.value = true
  // Un fichier restauré après rechargement ne démarre pas tout seul :
  // la lecture reprend à la position mémorisée, sur demande.
}

async function persistResult(fingerprint, file) {
  if (fingerprint !== currentFingerprint) return

  const language = outputLanguage.value
  const thumbnailDataUrl = isAudio.value ? null : await captureThumbnail(objectUrl)
  await saveProcessedVideo({
    fingerprint: subtitleCacheKey(fingerprint, language),
    fileName: file.name,
    durationSeconds: videoRef.value?.duration || 0,
    language,
    engine: engine.value,
    subtitles: subtitles.value,
    // Passages non traités : le bandeau de reprise reste disponible après rechargement.
    failedSegments: failedSegments.value,
    thumbnailDataUrl,
    createdAt: Date.now()
  })
  await refreshHistory()
}

async function refreshPartialInfo() {
  if (!currentFingerprint || status.value !== 'idle') return
  await generation.checkPartial(currentFingerprint, currentPartialMode, videoRef.value?.duration || 0)
}

function onSelectionChange({ partialMode }) {
  currentPartialMode = partialMode
  refreshPartialInfo()
}

function onLoadedMetadata() {
  videoDuration.value = videoRef.value?.duration || 0
  const saved = readPosition(queue.currentId.value)
  if (saved > 1 && saved < videoDuration.value - 2 && videoRef.value) videoRef.value.currentTime = saved
  refreshPartialInfo()
  metadataWaiter?.()
}

// Attend que la durée du média soit connue (indispensable avant de lancer
// un traitement), sans bloquer si le navigateur ne sait pas lire le fichier.
function waitForMetadata() {
  if (videoDuration.value > 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, 15000)
    function done() {
      clearTimeout(timer)
      metadataWaiter = null
      resolve()
    }
    metadataWaiter = done
  })
}

// Octets déjà envoyés au début de la génération en cours (pour le compteur du fichier).
const runBaseBytes = ref(0)
const runBytes = computed(() => Math.max(0, quota.sessionBytes - runBaseBytes.value))

function prepareRun() {
  runBaseBytes.value = quota.sessionBytes
  resetOutline()
  restoredFromCache.value = false
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false
}

/**
 * Lance une génération pour le fichier courant et sauvegarde le résultat.
 * Résout avec true (réussie), false (échec) ou null (annulée).
 */
async function runGeneration(task) {
  if (!currentFile.value || status.value === 'processing') return false
  prepareRun()

  const fingerprint = currentFingerprint
  const file = currentFile.value
  const id = queue.currentId.value
  if (id) queue.setStatus(id, 'processing')

  try {
    const result = await task({ fingerprint, file, durationHint: videoRef.value?.duration })
    if (result === null) {
      if (id) queue.setStatus(id, 'pending')
      return null // annulée (autre fichier chargé)
    }
  } catch (error) {
    console.error('Échec de la génération :', error)
    if (id) queue.setStatus(id, 'error', errorMessage.value || error.message)
    return false
  }

  try {
    await persistResult(fingerprint, file)
  } catch (error) {
    console.warn('Sauvegarde du résultat dans IndexedDB impossible :', error.message)
  }
  if (id) queue.setStatus(id, 'done')
  return true
}

// Choisit la première piste texte d'un fichier (utilisé par la file, où
// l'utilisateur ne choisit pas fichier par fichier).
async function resolveEmbeddedTrack(file) {
  const tracks = await probeSubtitleTracks(file)
  const track = tracks.find((candidate) => candidate.readable)
  if (!track) throw new Error(tracks.length ? t('embedded.onlyImage') : t('embedded.none'))
  return track
}

function generateSubtitles(options) {
  lastOptions = options
  lastApiKey.value = options.apiKey || ''
  return runGeneration(async ({ fingerprint, file, durationHint }) => {
    if (options.engine === 'online') {
      return generation.startOnline(file, {
        fingerprint,
        apiKey: options.apiKey,
        targetLanguage: options.targetLanguage,
        durationHint
      })
    }
    if (options.engine === 'embedded') {
      let { trackIndex, trackLanguage } = options
      if (trackIndex === null || trackIndex === undefined) {
        const track = await resolveEmbeddedTrack(file)
        trackIndex = track.index
        trackLanguage = track.language
      }
      return generation.startOnline(file, {
        fingerprint,
        apiKey: options.apiKey,
        targetLanguage: options.targetLanguage,
        durationHint,
        source: 'embedded',
        trackIndex,
        trackLanguage
      })
    }
    return generation.start(file, { fingerprint, mode: options.sourceMode, durationHint })
  })
}

function retryGeneration() {
  if (lastOptions) generateSubtitles(lastOptions)
}

function continueInLocal() {
  const options = lastOptions
  if (!options) return
  return runGeneration(({ fingerprint, file, durationHint }) =>
    generation.continueLocally(file, {
      fingerprint,
      onlineTarget: options.targetLanguage,
      localMode: options.sourceMode,
      durationHint
    })
  )
}

function resetOutline() {
  outlineController?.abort()
  outline.value = null
  outlineBusy.value = false
  outlineError.value = ''
  outlineProgress.value = { done: 0, total: 0 }
}

// Langue du résumé : celle des sous-titres, sinon celle de l'interface.
function outlineLanguage() {
  return outputLanguage.value === 'fr' || outputLanguage.value === 'en' ? outputLanguage.value : locale.value
}

async function createOutline({ apiKey }) {
  outlineController?.abort()
  outlineController = new AbortController()
  const controller = outlineController
  const fingerprint = currentFingerprint
  const language = outputLanguage.value
  outlineBusy.value = true
  outlineError.value = ''
  outlineProgress.value = { done: 0, total: 0 }
  const base = quota.sessionBytes
  try {
    const result = await generateOutline(subtitles.value, {
      apiKey,
      language: outlineLanguage(),
      signal: controller.signal,
      onProgress: (done, total) => {
        outlineProgress.value = { done, total }
      }
    })
    if (controller.signal.aborted || fingerprint !== currentFingerprint) return
    outline.value = result
    // Mémorisé avec les sous-titres : disponible après un rechargement.
    const record = await getProcessedVideo(subtitleCacheKey(fingerprint, language)).catch(() => null)
    if (record) await saveProcessedVideo({ ...record, outline: JSON.parse(JSON.stringify(result)) }).catch(() => {})
  } catch (error) {
    if (error.name === 'AbortError') return
    outlineError.value = error.message
  } finally {
    if (outlineController === controller) outlineBusy.value = false
  }
}

function seekToTime(seconds) {
  if (!videoRef.value) return
  videoRef.value.currentTime = Math.max(0, seconds + subtitleOffset.value)
}

function backToSettings() {
  generation.reset()
  refreshPartialInfo()
}

// --- Chargement d'un fichier ---

function loadFile(file, id) {
  generation.reset()
  if (objectUrl) URL.revokeObjectURL(objectUrl)

  objectUrl = URL.createObjectURL(file)
  currentFile.value = file
  currentKind.value = mediaKind(file) || 'video'
  currentFingerprint = id
  queue.setCurrent(id)
  videoSrc.value = objectUrl
  fileName.value = file.name
  activeIndex.value = -1
  activeSubtitleText.value = ''
  restoredFromCache.value = false
  showCatchUpPrompt.value = false
  bypassCatchUpCheck = false
  resetOutline()
  subtitleOffset.value = 0
  videoDuration.value = 0
  dropNotice.value = ''

  checkCache(currentFingerprint)
}

// Ouvre un élément de la file : charge son fichier s'il est disponible,
// sinon l'affiche comme "à rouvrir".
function selectItem(id) {
  if (queueRunning.value) return
  openItem(id)
}

function openItem(id) {
  const file = queue.fileFor(id)
  if (file) {
    loadFile(file, id)
    return true
  }
  generation.cancel()
  generation.reset()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = null
  videoSrc.value = null
  currentFile.value = null
  currentFingerprint = null
  queue.setCurrent(id)
  return false
}

async function reopenItem(id) {
  const file = await queue.reopen(id)
  if (file) {
    if (!videoSrc.value || queue.currentId.value === id || !queueRunning.value) openItem(id)
    return
  }
  // Pas de handle (ou permission refusée) : on demande de rechoisir le fichier.
  await pickFiles()
}

/** Ajoute des fichiers à la file ; le premier ouvre le lecteur s'il est vide. */
function addFiles(entries, { open = true } = {}) {
  let firstAdded = null
  let rejected = 0
  for (const { file, handle } of entries) {
    const item = queue.add(file, handle)
    if (!item) {
      rejected++
      continue
    }
    if (!firstAdded) firstAdded = item
  }
  dropNotice.value = rejected ? t('drop.ignored') : ''
  if (firstAdded && !queueRunning.value && (open || !videoSrc.value || queue.currentId.value === firstAdded.id)) {
    openItem(firstAdded.id)
  }
}

// Ouvrir le premier fichier choisi, ou seulement l'ajouter à la file ?
let openAfterPick = true

async function pickFiles(open = true) {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: PICKER_TYPES })
      const entries = await Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
      addFiles(entries, { open })
    } catch (error) {
      // AbortError : l'utilisateur a fermé la fenêtre.
      if (error.name !== 'AbortError') console.warn('Sélection de fichiers impossible :', error.message)
    }
    return
  }
  // Repli sans File System Access : le choix passe par le champ fichier.
  openAfterPick = open
  fileInputRef.value?.click()
}

function onFileInputChange(event) {
  addFiles([...event.target.files].map((file) => ({ file, handle: null })), { open: openAfterPick })
  openAfterPick = true
  event.target.value = ''
}

function onDrop(event) {
  event.preventDefault()
  isDraggingOver.value = false

  // Les handles doivent être demandés pendant l'évènement : la liste
  // d'éléments déposés n'est plus valide après le premier await.
  const dropped = [...event.dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => ({
      file: item.getAsFile(),
      handlePromise: typeof item.getAsFileSystemHandle === 'function' ? item.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null)
    }))

  Promise.all(
    dropped.map(async ({ file, handlePromise }) => {
      const handle = await handlePromise
      return { file, handle: handle?.kind === 'file' ? handle : null }
    })
  ).then((entries) => addFiles(entries, { open: !videoSrc.value }))
}

// --- File d'attente ---

function outputLanguageFor(options) {
  return options.engine === 'local' ? 'en' : options.targetLanguage
}

async function runQueue(options) {
  if (queueRunning.value) return
  lastOptions = options
  lastApiKey.value = options.apiKey || ''
  queueRunning.value = true
  stopRequested = false

  // Le fichier courant d'abord, puis le reste dans l'ordre d'ajout.
  const currentFirst = [...queue.items.value].sort((a, b) => (b.id === queue.currentId.value) - (a.id === queue.currentId.value))
  const ids = currentFirst
    .filter((item) => item.status !== 'done' && queue.hasFile(item.id))
    .map((item) => item.id)

  try {
    for (const id of ids) {
      if (stopRequested) break

      if (id !== queue.currentId.value || !videoSrc.value) {
        openItem(id)
        await waitForMetadata()
      }

      // Déjà sous-titré dans la langue demandée : rien à refaire.
      const cached = await getProcessedVideo(subtitleCacheKey(id, outputLanguageFor(options))).catch(() => null)
      if (cached) {
        queue.setStatus(id, 'done')
        continue
      }

      const result = await generateSubtitles(options)
      if (result === null) break
      if (result === false && QUEUE_STOPPING_ERRORS.includes(errorKind.value)) break
    }
  } finally {
    queueRunning.value = false
  }
}

function stopQueue() {
  stopRequested = true
  generation.cancel()
  generation.reset()
}

function onGenerate(options) {
  if (options.all) return runQueue(options)
  return generateSubtitles(options)
}

function removeItem(id) {
  if (id === queue.currentId.value) {
    generation.cancel()
    generation.reset()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = null
    videoSrc.value = null
    currentFile.value = null
    currentFingerprint = null
  }
  queue.remove(id)
}

function formatEta(seconds) {
  if (seconds === null || seconds === undefined) return ''
  if (seconds < 60) return t('phase.etaLess')
  return t('phase.etaMinutes', { minutes: Math.round(seconds / 60) })
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('pagehide', savePosition)
  await queue.load()
  // Reprise de la session précédente : le fichier s'ouvre seul quand le
  // navigateur a conservé l'autorisation, sinon un bouton propose de le rouvrir.
  if (queue.currentId.value && queue.items.value.some((item) => item.id === queue.currentId.value)) {
    openItem(queue.currentId.value)
  } else if (queue.currentId.value) {
    queue.setCurrent(null)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('pagehide', savePosition)
  savePosition()
  generation.cancel()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div class="grid gap-6" :class="videoSrc ? 'lg:grid-cols-[minmax(0,1fr)_22rem]' : ''">
    <div class="flex min-w-0 flex-col gap-6">
      <div
        class="self-stretch overflow-hidden rounded-2xl border bg-white shadow-card transition-colors"
        :class="isDraggingOver ? 'border-brand-500' : 'border-ink-200'"
        @dragover.prevent="isDraggingOver = true"
        @dragleave.prevent="isDraggingOver = false"
        @drop="onDrop"
      >
        <!-- Zone de dépôt -->
        <div
          v-if="!videoSrc"
          class="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center transition-colors sm:py-20"
          :class="isDraggingOver ? 'bg-brand-50' : 'bg-white'"
        >
          <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <AppIcon name="film" class="h-7 w-7" />
          </span>

          <template v-if="pendingRestore">
            <div>
              <p class="text-lg font-semibold text-ink-900">{{ pendingRestore.name }}</p>
              <p class="mx-auto mt-1 max-w-md text-sm text-ink-500">{{ t('drop.reopenHint') }}</p>
            </div>
            <button class="btn-primary" data-testid="reopen" @click="reopenItem(pendingRestore.id)">
              {{ t('drop.reopen', { name: pendingRestore.name }) }}
            </button>
            <button class="text-sm text-brand-600 hover:text-brand-700" @click="pickFiles()">{{ t('drop.choose') }}</button>
          </template>

          <template v-else>
            <div>
              <p class="text-lg font-semibold text-ink-900">{{ touchDevice ? t('drop.titleTouch') : t('drop.title') }}</p>
              <p class="mt-1 text-sm text-ink-500">{{ t('drop.hint') }}</p>
            </div>
            <button class="btn-primary" @click="pickFiles()">{{ t('drop.choose') }}</button>
          </template>
          <p v-if="dropNotice" class="text-sm text-red-600">{{ dropNotice }}</p>
        </div>

        <!-- Lecteur -->
        <template v-else>
          <div ref="playerContainerRef" class="group relative bg-black">
            <video
              ref="videoRef"
              :src="videoSrc"
              controls
              :controlslist="canFullscreenContainer ? 'nofullscreen' : null"
              class="block w-full bg-black"
              :class="isAudio ? 'h-56' : isFullscreen ? 'h-screen object-contain' : 'max-h-[70vh]'"
              @timeupdate="onTimeUpdate"
              @seeked="savePosition"
              @pause="savePosition"
              @loadedmetadata="onLoadedMetadata"
              @click="toggleVideoPlayback"
            ></video>

            <div v-if="isAudio" class="pointer-events-none absolute inset-x-0 top-0 flex h-40 flex-col items-center justify-center gap-2 text-white/70">
              <AppIcon name="play" class="h-8 w-8" />
              <span class="text-xs">{{ t('player.audioOnly') }}</span>
            </div>

            <div
              v-if="(status === 'ready' || playbackUnlocked) && activeSubtitleText"
              class="pointer-events-none absolute inset-x-0 flex justify-center px-6"
              :class="isAudio ? 'bottom-16' : 'bottom-[12%]'"
            >
              <p class="subtitle-overlay whitespace-pre-line bg-black px-3 py-1.5 text-center font-medium text-white">
                {{ activeSubtitleText }}
              </p>
            </div>

            <button
              v-if="!isAudio && canFullscreenContainer"
              class="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg bg-black/50 text-white transition-opacity focus:opacity-100 sm:h-9 sm:w-9 sm:opacity-0 sm:group-hover:opacity-100"
              :aria-label="isFullscreen ? t('player.exitFullscreen') : t('player.fullscreen')"
              @click="toggleFullscreen"
            >
              <AppIcon :name="isFullscreen ? 'exitFullscreen' : 'fullscreen'" class="h-5 w-5" />
            </button>

            <div v-if="showCatchUpPrompt" class="absolute inset-0 flex items-center justify-center bg-black/70 p-6">
              <div class="flex max-w-sm flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-card">
                <p class="text-sm text-ink-700">{{ t('catchup.text') }}</p>
                <div class="flex justify-center gap-2">
                  <button class="btn-secondary" @click="keepWaiting">{{ t('catchup.wait') }}</button>
                  <button class="btn-primary" @click="continueWithoutSubtitles">{{ t('catchup.continue') }}</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Barre d'état sous le lecteur -->
          <div class="flex flex-col gap-4 p-5">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <p class="truncate text-sm font-medium text-ink-900" :title="fileName">{{ fileName }}</p>
              <button class="-my-2 py-2 text-sm text-brand-600 hover:text-brand-700" @click="pickFiles()">{{ t('player.changeFile') }}</button>
            </div>

            <!-- Prêt à générer -->
            <GenerationPanel
              v-if="status === 'idle' && !queueRunning"
              :partial-info="partialInfo"
              :duration-seconds="videoDuration"
              :file="currentFile"
              :kind="currentKind"
              :queue-count="queueToProcess"
              @selection="onSelectionChange"
              @generate="onGenerate"
            />

            <!-- Traitement en cours -->
            <div v-if="status === 'processing'" class="flex flex-col gap-3">
              <div v-if="playbackUnlocked" class="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
                <AppIcon name="check" class="h-5 w-5 flex-shrink-0 text-brand-600" />
                <span>{{ t('phase.unlocked') }}</span>
              </div>

              <div class="flex flex-col gap-1.5">
                <p class="text-sm text-ink-700">
                  <template v-if="processingPhase === 'decoding'">{{ engine === 'local' ? t('phase.decodingLocal') : t('phase.decoding') }}</template>
                  <template v-else-if="processingPhase === 'loading'">{{ t('phase.loading') }}</template>
                  <template v-else-if="processingPhase === 'downloading'">
                    {{ t('phase.downloading') }}
                    <span class="text-ink-500">({{ Math.round(modelDownloadProgress) }} %)</span>
                  </template>
                  <template v-else>
                    {{ engine === 'online' ? t('phase.generatingOnline') : engine === 'embedded' ? t('phase.translatingEmbedded') : t('phase.generatingLocal') }}
                    <span class="text-ink-500">
                      ({{ progressPercent }} %<template v-if="etaSeconds !== null"> &middot; {{ t('phase.eta', { time: formatEta(etaSeconds) }) }}</template>)
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

                <p v-if="network.state === 'retrying'" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                  {{ t('net.retrying', { seconds: network.seconds, attempt: network.attempt, max: network.maxAttempts }) }}
                </p>
                <p v-else-if="network.state === 'offline'" class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
                  {{ t('net.offline') }}
                </p>
                <p v-if="engine !== 'local' && runBytes > 0" class="text-xs text-ink-500">
                  {{ t('data.sentRun', { size: formatMegabytes(runBytes) }) }}
                </p>
                <p v-if="processingPhase === 'downloading'" class="text-xs text-ink-500">{{ t('phase.downloadingHint') }}</p>
                <p v-if="processingPhase === 'generating' && silenceSkippedSeconds > 1" class="text-xs text-ink-500">
                  {{ t('phase.silence', { seconds: Math.round(silenceSkippedSeconds) }) }}
                </p>
              </div>
            </div>

            <!-- Terminé -->
            <div v-if="status === 'ready'" class="flex flex-wrap items-center justify-between gap-3">
              <p class="flex items-center gap-2 text-sm text-ink-600">
                <AppIcon name="check" class="h-4 w-4 text-brand-600" />
                {{ !subtitles.length ? t('ready.none') : restoredFromCache ? t('ready.restored') : t('ready.done') }}
                <span v-if="subtitles.length" class="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700">
                  {{ t('lang.' + outputLanguage) }}
                </span>
              </p>
              <div v-if="subtitles.length" class="flex gap-2">
                <button class="btn-secondary !px-3 !py-1.5" @click="exportSubtitles('srt')">
                  <AppIcon name="download" class="h-4 w-4" /> {{ t('export.srt') }}
                </button>
                <button class="btn-secondary !px-3 !py-1.5" @click="exportSubtitles('vtt')">
                  <AppIcon name="download" class="h-4 w-4" /> {{ t('export.vtt') }}
                </button>
              </div>
            </div>

            <div
              v-if="status === 'ready' && failedSegments > 0"
              class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3"
              role="status"
            >
              <p class="text-sm text-amber-900">{{ t('ready.failedSegments', { count: failedSegments }) }}</p>
              <button class="btn-secondary !px-3 !py-1.5" @click="backToSettings">{{ t('ready.retryFailed') }}</button>
            </div>

            <div v-if="status === 'error'" class="flex flex-col gap-3 rounded-xl bg-red-50 px-4 py-3">
              <p class="text-sm text-red-700">{{ errorMessage }}</p>
              <div class="flex flex-wrap gap-2">
                <button v-if="errorKind === 'auth'" class="btn-secondary !px-3 !py-1.5" @click="backToSettings">{{ t('error.changeKey') }}</button>
                <button v-else-if="engine !== 'local'" class="btn-secondary !px-3 !py-1.5" @click="retryGeneration">{{ t('error.retry') }}</button>
                <button v-if="canContinueLocally" class="btn-primary !px-3 !py-1.5" @click="continueInLocal">
                  {{ t('error.finishLocal') }}
                </button>
                <button v-if="engine === 'local' || engine === 'embedded' || errorKind === 'auth'" class="btn-secondary !px-3 !py-1.5" @click="backToSettings">{{ t('error.backToSettings') }}</button>
              </div>
              <p v-if="canContinueLocally" class="text-xs text-red-700/80">{{ t('error.finishLocalHint') }}</p>
            </div>
          </div>
        </template>
      </div>

      <QueuePanel
        v-if="queue.items.value.length"
        :items="queue.items.value"
        :current-id="queue.currentId.value"
        :running="queueRunning"
        :has-file="queue.hasFile"
        @select="selectItem"
        @remove="removeItem"
        @clear-done="queue.clearDone"
        @reopen="reopenItem"
        @add="pickFiles(false)"
        @stop="stopQueue"
      />
    </div>

    <section
      v-if="videoSrc"
      class="relative h-[32rem] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card lg:h-auto lg:min-h-[24rem]"
    >
      <div class="absolute inset-0 flex flex-col">
        <div class="flex gap-1 border-b border-ink-100 px-2 pt-2" role="tablist">
          <button
            v-for="tab in ['transcript', 'outline']"
            :key="tab"
            role="tab"
            :aria-selected="rightTab === tab"
            class="rounded-t-lg px-3 py-2 text-sm font-medium transition-colors"
            :class="rightTab === tab ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:text-ink-800'"
            :data-testid="'tab-' + tab"
            @click="rightTab = tab"
          >
            {{ t('tab.' + tab) }}
          </button>
        </div>

        <TranscriptPanel
          v-show="rightTab === 'transcript'"
          v-model:offset="subtitleOffset"
          :subtitles="subtitles"
          :active-index="activeIndex"
          @seek="seekToSubtitle"
        />
        <OutlinePanel
          v-show="rightTab === 'outline'"
          :outline="outline"
          :available="status === 'ready' && subtitles.length > 0"
          :busy="outlineBusy"
          :progress="outlineProgress"
          :error="outlineError"
          :known-key="lastApiKey"
          :playhead="playhead"
          @generate="createOutline"
          @seek="seekToTime"
          @cancel="resetOutline"
          @reset="outline = null"
        />
      </div>
    </section>

    <input ref="fileInputRef" type="file" multiple :accept="FILE_INPUT_ACCEPT" class="hidden" @change="onFileInputChange" />
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
