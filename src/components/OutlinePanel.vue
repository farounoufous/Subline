<script setup>
import { ref, computed, watch } from 'vue'
import AppIcon from './ui/AppIcon.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  // { summary, chapters: [{ time, title }], language } ou null
  outline: { type: Object, default: null },
  // Les sous-titres sont-ils terminés (donc exploitables) ?
  available: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  progress: { type: Object, default: () => ({ done: 0, total: 0 }) },
  error: { type: String, default: '' },
  // Clé déjà connue (saisie pour la génération des sous-titres).
  knownKey: { type: String, default: '' },
  // Position de lecture, pour surligner le chapitre en cours.
  playhead: { type: Number, default: 0 }
})

const emit = defineEmits(['generate', 'seek', 'cancel', 'reset'])

const STORED_KEY = 'subline:groq-key'
function readStoredKey() {
  try {
    return localStorage.getItem(STORED_KEY) || ''
  } catch {
    return ''
  }
}

const apiKey = ref(props.knownKey || readStoredKey())
const consent = ref(false)
watch(() => props.knownKey, (value) => {
  if (value && !apiKey.value) apiKey.value = value
})

const canGenerate = computed(() => props.available && apiKey.value.trim().length > 0 && consent.value && !props.busy)

const activeChapter = computed(() => {
  const chapters = props.outline?.chapters || []
  let active = -1
  chapters.forEach((chapter, index) => {
    if (props.playhead >= chapter.time) active = index
  })
  return active
})

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

function submit() {
  if (canGenerate.value) emit('generate', { apiKey: apiKey.value.trim() })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="outline">
    <header class="flex items-center gap-2 border-b border-ink-100 p-4">
      <AppIcon name="lines" class="h-4 w-4 text-ink-500" />
      <h3 class="text-sm font-semibold text-ink-900">{{ t('outline.title') }}</h3>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <p v-if="!available" class="text-center text-sm text-ink-500">{{ t('outline.notReady') }}</p>

      <!-- Résultat -->
      <template v-else-if="outline">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-ink-500">{{ t('outline.summary') }}</h4>
        <p class="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-800" data-testid="outline-summary">{{ outline.summary }}</p>

        <h4 class="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-500">{{ t('outline.chapters') }}</h4>
        <p v-if="!outline.chapters.length" class="mt-2 text-sm text-ink-500">{{ t('outline.noChapters') }}</p>
        <ul v-else class="mt-2 flex flex-col gap-0.5">
          <li v-for="(chapter, index) in outline.chapters" :key="`${chapter.time}-${index}`">
            <button
              class="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-50"
              :class="index === activeChapter ? 'bg-brand-50' : ''"
              @click="emit('seek', chapter.time)"
            >
              <span class="w-12 flex-shrink-0 pt-0.5 text-xs tabular-nums" :class="index === activeChapter ? 'text-brand-600' : 'text-ink-400'">
                {{ formatTime(chapter.time) }}
              </span>
              <span class="text-sm leading-snug" :class="index === activeChapter ? 'font-medium text-ink-900' : 'text-ink-700'">{{ chapter.title }}</span>
            </button>
          </li>
        </ul>

        <button class="mt-5 text-sm text-brand-600 hover:text-brand-700 disabled:opacity-50" :disabled="busy" @click="emit('reset')">
          {{ t('outline.regenerate') }}
        </button>
      </template>

      <!-- En cours -->
      <div v-else-if="busy" class="flex flex-col gap-3">
        <p class="text-sm text-ink-700">{{ t('outline.generating', { done: progress.done, total: progress.total || '…' }) }}</p>
        <div class="h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            class="h-full rounded-full bg-brand-600 transition-[width] duration-300"
            :style="{ width: (progress.total ? Math.round((progress.done / progress.total) * 100) : 5) + '%' }"
          ></div>
        </div>
        <button class="self-start text-sm text-ink-500 hover:text-ink-800" @click="emit('cancel')">{{ t('outline.cancel') }}</button>
      </div>

      <!-- Demande -->
      <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
        <p class="text-sm leading-relaxed text-ink-600">{{ t('outline.intro') }}</p>

        <div v-if="!apiKey">
          <label for="outline-key" class="text-sm font-medium text-ink-900">{{ t('online.keyLabel') }}</label>
          <input
            id="outline-key"
            v-model="apiKey"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="gsk_..."
            class="mt-2 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>

        <label class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <input v-model="consent" type="checkbox" class="mt-0.5 rounded border-amber-300 text-brand-600" />
          <span>{{ t('outline.consent') }}</span>
        </label>

        <p v-if="error" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{{ error }}</p>

        <button type="submit" class="btn-primary self-start disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canGenerate">
          {{ t('outline.generate') }}
        </button>
      </form>
    </div>
  </div>
</template>
