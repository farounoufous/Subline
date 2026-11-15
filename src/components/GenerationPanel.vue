<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import AppIcon from './ui/AppIcon.vue'
import QuotaMeter from './QuotaMeter.vue'
import { t } from '../i18n/index.js'
import { probeSubtitleTracks } from '../audio/embedded-subtitles.js'
import { detectDevice } from '../utils/device.js'
import { MODEL_DOWNLOAD_SIZE_LABEL } from '../audio/constants.js'
import { ONLINE_AUDIO_BITRATE_KBPS } from '../audio/audio-stream.js'

const props = defineProps({
  partialInfo: { type: Object, default: null },
  durationSeconds: { type: Number, default: 0 },
  // Fichier courant (pour lire ses pistes de sous-titres) et son type.
  file: { type: Object, default: null },
  kind: { type: String, default: 'video' },
  // Nombre de fichiers encore à traiter dans la file (courant compris).
  queueCount: { type: Number, default: 1 }
})

// 'selection' : le parent en déduit quelle progression interrompue chercher.
// 'generate'  : paramètres complets de la génération demandée.
const emit = defineEmits(['generate', 'selection'])

const STORAGE_KEYS = {
  sourceMode: 'subline:source-mode',
  targetLanguage: 'subline:target-language',
  apiKey: 'subline:groq-key'
}
const GROQ_KEYS_URL = 'https://console.groq.com/keys'

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Stockage indisponible (navigation privée...) : sans conséquence.
  }
}

// Toujours "local" au départ : l'envoi d'audio doit rester un choix
// explicite, jamais un réglage mémorisé à l'insu de l'utilisateur.
const engine = ref('local')
const sourceMode = ref(readStored(STORAGE_KEYS.sourceMode, 'english') === 'translate' ? 'translate' : 'english')
const targetLanguage = ref(readStored(STORAGE_KEYS.targetLanguage, 'fr') === 'en' ? 'en' : 'fr')
const storedKey = readStored(STORAGE_KEYS.apiKey, '')
const apiKey = ref(storedKey)
const rememberKey = ref(Boolean(storedKey))
// Le consentement est redemandé à chaque session.
const consent = ref(false)

const engines = computed(() => {
  const list = [
    { value: 'local', key: 'local' },
    { value: 'online', key: 'online' }
  ]
  // Un fichier audio ne contient pas de piste de sous-titres.
  if (props.kind === 'video') list.push({ value: 'embedded', key: 'embedded' })
  return list
})
const BADGE_CLASSES = {
  local: 'bg-emerald-100 text-emerald-800',
  online: 'bg-amber-100 text-amber-800',
  embedded: 'bg-amber-100 text-amber-800'
}

// Appareil limité (téléphone, peu de mémoire) : le mode Local y est déconseillé.
const limitedDevice = detectDevice().limited

const sourceOptions = computed(() => [
  { value: 'english', label: t('local.sourceEnglish') },
  { value: 'translate', label: t('local.sourceOther') }
])
const targetOptions = computed(() => [
  { value: 'fr', label: t('lang.fr') },
  { value: 'en', label: t('lang.en') }
])

// --- Sous-titres intégrés : lecture des pistes du fichier courant ---
const scan = ref({ state: 'idle', tracks: [], error: '' }) // idle | scanning | done | error
const trackIndex = ref(null)
let scanController = null

async function scanTracks() {
  scanController?.abort()
  scanController = new AbortController()
  const controller = scanController
  const file = props.file
  scan.value = { state: 'scanning', tracks: [], error: '' }
  trackIndex.value = null
  try {
    const tracks = await probeSubtitleTracks(file, controller.signal)
    if (controller.signal.aborted) return
    scan.value = { state: 'done', tracks, error: '' }
    trackIndex.value = tracks.find((track) => track.readable)?.index ?? null
  } catch (error) {
    if (controller.signal.aborted) return
    scan.value = { state: 'error', tracks: [], error: error.message }
  }
}

watch(
  () => props.kind,
  (kind) => {
    if (kind === 'audio' && engine.value === 'embedded') engine.value = 'local'
  }
)

watch(
  () => [engine.value, props.file],
  ([value]) => {
    if (value === 'embedded' && props.file) scanTracks()
  }
)
onBeforeUnmount(() => scanController?.abort())

const selectedTrack = computed(() => scan.value.tracks.find((track) => track.index === trackIndex.value) || null)
const readableTracks = computed(() => scan.value.tracks.filter((track) => track.readable))
const sameLanguage = computed(() => selectedTrack.value?.language === targetLanguage.value)

function trackLabel(track) {
  const language = track.language ? (t('lang.' + track.language) !== 'lang.' + track.language ? t('lang.' + track.language) : track.language) : t('embedded.unknownLanguage')
  const base = t('embedded.track', { n: track.index + 1, language, codec: track.codec })
  return track.title ? `${base} - ${track.title}` : base
}

const partialMode = computed(() => {
  if (engine.value === 'online') return `online-${targetLanguage.value}`
  if (engine.value === 'embedded') return `embedded-${trackIndex.value ?? 0}-${targetLanguage.value}`
  return sourceMode.value
})

const estimate = computed(() => {
  if (!props.durationSeconds) return null
  const megabytes = (props.durationSeconds * ONLINE_AUDIO_BITRATE_KBPS * 1000) / 8 / 1_000_000
  const minutes = Math.ceil(props.durationSeconds / 60)
  return { megabytes: Math.max(1, Math.round(megabytes)), minutes }
})

const canGenerate = computed(() => {
  if (engine.value === 'local') return true
  if (engine.value === 'embedded' && trackIndex.value === null) return false
  // Une piste déjà dans la langue choisie est simplement importée : rien à envoyer.
  if (engine.value === 'embedded' && sameLanguage.value) return true
  return apiKey.value.trim().length > 0 && consent.value
})

watch(sourceMode, (value) => writeStored(STORAGE_KEYS.sourceMode, value))
watch(targetLanguage, (value) => writeStored(STORAGE_KEYS.targetLanguage, value))
watch([apiKey, rememberKey], () => {
  writeStored(STORAGE_KEYS.apiKey, rememberKey.value && apiKey.value.trim() ? apiKey.value.trim() : null)
})
watch(partialMode, (mode) => emit('selection', { engine: engine.value, partialMode: mode }), { immediate: true })

const needsKey = computed(() => engine.value === 'online' || (engine.value === 'embedded' && !sameLanguage.value))

function submit(all = false) {
  if (!canGenerate.value) return
  emit('generate', {
    engine: engine.value,
    sourceMode: sourceMode.value,
    targetLanguage: targetLanguage.value,
    apiKey: apiKey.value.trim(),
    trackIndex: trackIndex.value,
    trackLanguage: selectedTrack.value?.language ?? null,
    all
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Choix du moteur : cartes explicites -->
    <div class="grid gap-3" :class="engines.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'" role="radiogroup" :aria-label="t('engine.group')">
      <button
        v-for="option in engines"
        :key="option.value"
        role="radio"
        :aria-checked="engine === option.value"
        class="flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :class="engine === option.value ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300'"
        @click="engine = option.value"
      >
        <span class="flex items-center justify-between gap-2">
          <span class="text-sm font-semibold text-ink-900">{{ t('engine.' + option.key + '.title') }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="BADGE_CLASSES[option.value]">
            {{ t('engine.' + option.key + '.badge') }}
          </span>
        </span>
        <span class="text-xs leading-relaxed text-ink-600">{{ t('engine.' + option.key + '.text') }}</span>
      </button>
    </div>

    <!-- Réglages du mode local -->
    <div v-if="engine === 'local'" class="flex flex-col gap-3 rounded-xl bg-ink-50 p-4">
      <div>
        <p class="text-sm font-medium text-ink-900">{{ t('local.sourceLabel') }}</p>
        <div class="mt-2 inline-flex flex-wrap rounded-lg border border-ink-200 bg-white p-1" role="radiogroup" :aria-label="t('local.sourceLabel')">
          <button
            v-for="option in sourceOptions"
            :key="option.value"
            role="radio"
            :aria-checked="sourceMode === option.value"
            class="rounded-md px-3 py-2 text-sm transition-colors sm:py-1.5"
            :class="sourceMode === option.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
            @click="sourceMode = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div v-if="limitedDevice" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900" data-testid="limited-warning">
        <p>{{ t('local.limitedWarning') }}</p>
        <button class="mt-2 font-medium text-brand-700 hover:text-brand-800" @click="engine = 'online'">{{ t('local.switchToOnline') }}</button>
      </div>
      <p class="text-sm text-ink-600">{{ t('local.modelNote', { size: MODEL_DOWNLOAD_SIZE_LABEL }) }}</p>
    </div>

    <!-- Réglages des modes en ligne et sous-titres intégrés -->
    <div v-else class="flex flex-col gap-4 rounded-xl bg-ink-50 p-4">
      <!-- Choix de la piste (sous-titres intégrés) -->
      <div v-if="engine === 'embedded'">
        <p v-if="scan.state === 'scanning'" class="text-sm text-ink-600">{{ t('embedded.scanning') }}</p>
        <p v-else-if="scan.state === 'error'" class="text-sm text-red-700">{{ t('embedded.scanFailed', { detail: scan.error }) }}</p>
        <template v-else-if="scan.state === 'done'">
          <p v-if="scan.tracks.length === 0" class="text-sm text-ink-700">{{ t('embedded.none') }}</p>
          <p v-else-if="readableTracks.length === 0" class="text-sm text-ink-700">{{ t('embedded.onlyImage') }}</p>
          <div v-else>
            <label for="track" class="text-sm font-medium text-ink-900">{{ t('embedded.trackLabel') }}</label>
            <select
              id="track"
              v-model="trackIndex"
              class="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              <option v-for="track in readableTracks" :key="track.index" :value="track.index">{{ trackLabel(track) }}</option>
            </select>
            <p v-if="scan.tracks.length > readableTracks.length" class="mt-2 text-xs text-ink-500">{{ t('embedded.imageTrack') }}</p>
          </div>
        </template>
      </div>

      <div v-if="engine === 'online' || trackIndex !== null">
        <p class="text-sm font-medium text-ink-900">{{ t('online.targetLabel') }}</p>
        <div class="mt-2 inline-flex rounded-lg border border-ink-200 bg-white p-1" role="radiogroup" :aria-label="t('online.targetLabel')">
          <button
            v-for="option in targetOptions"
            :key="option.value"
            role="radio"
            :aria-checked="targetLanguage === option.value"
            class="rounded-md px-3 py-2 text-sm transition-colors sm:py-1.5"
            :class="targetLanguage === option.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
            @click="targetLanguage = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <p v-if="engine === 'online'" class="mt-2 text-xs text-ink-500">{{ t('online.targetHint') }}</p>
        <p v-else-if="sameLanguage" class="mt-2 text-xs text-ink-500">{{ t('embedded.sameLanguage') }}</p>
      </div>

      <template v-if="needsKey && (engine === 'online' || trackIndex !== null)">
        <div>
          <label for="groq-key" class="text-sm font-medium text-ink-900">{{ t('online.keyLabel') }}</label>
          <input
            id="groq-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="gsk_..."
            class="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
            <label class="flex items-center gap-2">
              <input v-model="rememberKey" type="checkbox" class="rounded border-ink-300 text-brand-600" />
              {{ t('online.remember') }}
            </label>
            <a :href="GROQ_KEYS_URL" target="_blank" rel="noopener" class="text-brand-600 hover:text-brand-700">{{ t('online.getKey') }}</a>
          </div>
        </div>

        <label class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <input v-model="consent" type="checkbox" class="mt-0.5 rounded border-amber-300 text-brand-600" />
          <span>
            {{ engine === 'online' ? t('online.consentAudio') : t('online.consentText') }}
            <template v-if="engine === 'online' && estimate">
              {{ t('online.estimate', { mb: estimate.megabytes, minutes: estimate.minutes }) }}
            </template>
          </span>
        </label>
      </template>

      <QuotaMeter v-if="engine === 'online'" />
    </div>

    <p v-if="partialInfo" class="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
      {{ t('generate.partial', { percent: partialInfo.percent }) }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <button class="btn-primary disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canGenerate" @click="submit(false)">
        <AppIcon v-if="engine !== 'local'" name="upload" class="h-4 w-4" />
        {{ partialInfo ? t('generate.resume') : t('generate.' + engine) }}
      </button>
      <button
        v-if="queueCount > 1"
        class="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canGenerate"
        @click="submit(true)"
      >
        {{ t('queue.runAll') }} ({{ queueCount }})
      </button>
    </div>
  </div>
</template>
