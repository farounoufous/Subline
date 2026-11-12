<script setup>
import { ref, computed, watch } from 'vue'
import AppIcon from './ui/AppIcon.vue'
import { MODEL_DOWNLOAD_SIZE_LABEL } from '../audio/constants.js'
import { ONLINE_AUDIO_BITRATE_KBPS } from '../audio/audio-stream.js'

const props = defineProps({
  partialInfo: { type: Object, default: null },
  durationSeconds: { type: Number, default: 0 }
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

const ENGINES = [
  {
    value: 'local',
    title: 'Local',
    badge: 'Privé',
    text: 'Tout reste sur votre appareil et fonctionne hors ligne. Sous-titres en anglais. Modèle à télécharger au premier usage.'
  },
  {
    value: 'online',
    title: 'En ligne',
    badge: 'Audio envoyé',
    text: 'Plus rapide et plus précis, depuis toutes les langues vers le français ou l\'anglais. Seul l\'audio compressé est envoyé, jamais la vidéo.'
  }
]

const SOURCE_OPTIONS = [
  { value: 'english', label: 'Anglais' },
  { value: 'translate', label: 'Autre langue (traduire en anglais)' }
]
const TARGET_OPTIONS = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' }
]

const partialMode = computed(() => (engine.value === 'online' ? `online-${targetLanguage.value}` : sourceMode.value))

const estimate = computed(() => {
  if (!props.durationSeconds) return null
  const megabytes = (props.durationSeconds * ONLINE_AUDIO_BITRATE_KBPS * 1000) / 8 / 1_000_000
  const minutes = Math.ceil(props.durationSeconds / 60)
  return { megabytes: Math.max(1, Math.round(megabytes)), minutes }
})

const canGenerate = computed(() => {
  if (engine.value === 'local') return true
  return apiKey.value.trim().length > 0 && consent.value
})

watch(sourceMode, (value) => writeStored(STORAGE_KEYS.sourceMode, value))
watch(targetLanguage, (value) => writeStored(STORAGE_KEYS.targetLanguage, value))
watch([apiKey, rememberKey], () => {
  writeStored(STORAGE_KEYS.apiKey, rememberKey.value && apiKey.value.trim() ? apiKey.value.trim() : null)
})
watch(partialMode, (mode) => emit('selection', { engine: engine.value, partialMode: mode }), { immediate: true })

function submit() {
  if (!canGenerate.value) return
  emit('generate', {
    engine: engine.value,
    sourceMode: sourceMode.value,
    targetLanguage: targetLanguage.value,
    apiKey: apiKey.value.trim()
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Choix du moteur : deux cartes explicites -->
    <div class="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Mode de génération">
      <button
        v-for="option in ENGINES"
        :key="option.value"
        role="radio"
        :aria-checked="engine === option.value"
        class="flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        :class="engine === option.value ? 'border-brand-500 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300'"
        @click="engine = option.value"
      >
        <span class="flex items-center justify-between">
          <span class="text-sm font-semibold text-ink-900">{{ option.title }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium"
            :class="option.value === 'local' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
          >
            {{ option.badge }}
          </span>
        </span>
        <span class="text-xs leading-relaxed text-ink-600">{{ option.text }}</span>
      </button>
    </div>

    <!-- Réglages du mode local -->
    <div v-if="engine === 'local'" class="flex flex-col gap-3 rounded-xl bg-ink-50 p-4">
      <div>
        <p class="text-sm font-medium text-ink-900">Langue parlée dans la vidéo</p>
        <div class="mt-2 inline-flex flex-wrap rounded-lg border border-ink-200 bg-white p-1" role="radiogroup" aria-label="Langue parlée dans la vidéo">
          <button
            v-for="option in SOURCE_OPTIONS"
            :key="option.value"
            role="radio"
            :aria-checked="sourceMode === option.value"
            class="rounded-md px-3 py-1.5 text-sm transition-colors"
            :class="sourceMode === option.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
            @click="sourceMode = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <p class="text-sm text-ink-600">
        Le modèle IA ({{ MODEL_DOWNLOAD_SIZE_LABEL }}) est téléchargé au premier usage, puis conservé pour un usage hors ligne.
      </p>
    </div>

    <!-- Réglages du mode en ligne -->
    <div v-else class="flex flex-col gap-4 rounded-xl bg-ink-50 p-4">
      <div>
        <p class="text-sm font-medium text-ink-900">Langue des sous-titres</p>
        <div class="mt-2 inline-flex rounded-lg border border-ink-200 bg-white p-1" role="radiogroup" aria-label="Langue des sous-titres">
          <button
            v-for="option in TARGET_OPTIONS"
            :key="option.value"
            role="radio"
            :aria-checked="targetLanguage === option.value"
            class="rounded-md px-3 py-1.5 text-sm transition-colors"
            :class="targetLanguage === option.value ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
            @click="targetLanguage = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <p class="mt-2 text-xs text-ink-500">La langue parlée est détectée automatiquement. Une vidéo déjà dans la langue choisie est simplement transcrite.</p>
      </div>

      <div>
        <label for="groq-key" class="text-sm font-medium text-ink-900">Clé API Groq (gratuite)</label>
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
            Mémoriser la clé sur cet appareil
          </label>
          <a :href="GROQ_KEYS_URL" target="_blank" rel="noopener" class="text-brand-600 hover:text-brand-700">Obtenir une clé gratuite</a>
        </div>
      </div>

      <label class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
        <input v-model="consent" type="checkbox" class="mt-0.5 rounded border-amber-300 text-brand-600" />
        <span>
          Je comprends que l'audio de cette vidéo (compressé, sans l'image) sera envoyé à Groq pour être transcrit et traduit.
          <template v-if="estimate">
            Environ {{ estimate.megabytes }} Mo envoyés et {{ estimate.minutes }} min de quota audio gratuit consommées.
          </template>
        </span>
      </label>
    </div>

    <p v-if="partialInfo" class="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
      Une génération interrompue a été retrouvée ({{ partialInfo.percent }} % déjà traité). Elle sera reprise là où elle s'est arrêtée.
    </p>

    <button class="btn-primary self-start disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canGenerate" @click="submit">
      <AppIcon v-if="engine === 'online'" name="upload" class="h-4 w-4" />
      {{ partialInfo ? 'Reprendre la génération' : engine === 'online' ? 'Générer en ligne' : 'Générer en local' }}
    </button>
  </div>
</template>
