<script setup>
import { ref, watch, nextTick } from 'vue'
import AppIcon from './ui/AppIcon.vue'
import { t } from '../i18n/index.js'

const props = defineProps({
  subtitles: { type: Array, required: true },
  activeIndex: { type: Number, default: -1 },
  // Décalage appliqué à l'affichage (secondes) : positif = plus tard.
  offset: { type: Number, default: 0 }
})

const emit = defineEmits(['seek', 'update:offset'])

const OFFSET_STEP_SECONDS = 0.5

const listRef = ref(null)

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds + props.offset))
  const minutes = Math.floor(total / 60)
  const rest = String(total % 60).padStart(2, '0')
  return `${minutes}:${rest}`
}

function formatOffset(value) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)} s`
}

function changeOffset(delta) {
  // Arrondi pour éviter les dérives de flottants (0.1 + 0.2...).
  emit('update:offset', Math.round((props.offset + delta) * 10) / 10)
}

// Garde la ligne active visible en faisant défiler uniquement la liste
// (scrollIntoView ferait aussi défiler toute la page).
watch(
  () => props.activeIndex,
  async (index) => {
    if (index < 0 || !listRef.value) return
    await nextTick()
    const item = listRef.value.querySelector(`[data-index="${index}"]`)
    if (!item) return

    const container = listRef.value
    const itemTop = item.offsetTop - container.offsetTop
    const itemBottom = itemTop + item.offsetHeight
    if (itemTop < container.scrollTop || itemBottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({ top: itemTop - container.clientHeight / 3, behavior: 'smooth' })
    }
  }
)
</script>

<template>
  <!-- Hauteur : celle du lecteur sur grand écran (contenu en absolu pour que
       une longue liste ne fasse pas grandir la ligne de la grille). -->
  <section class="relative h-[32rem] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card lg:h-auto lg:min-h-[24rem]">
    <div class="absolute inset-0 flex flex-col">
    <header class="border-b border-ink-100 p-4">
      <div class="flex items-center gap-2">
        <AppIcon name="lines" class="h-4 w-4 text-ink-500" />
        <h3 class="text-sm font-semibold text-ink-900">{{ t('transcript.title') }}</h3>
        <span class="ml-auto text-xs tabular-nums text-ink-400">{{ subtitles.length }}</span>
      </div>

      <div class="mt-3 flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2 py-1.5">
        <span class="text-xs text-ink-600">{{ t('transcript.offset') }}</span>
        <div class="flex items-center gap-1">
          <button
            class="h-7 w-7 rounded-md border border-ink-200 bg-white text-sm text-ink-700 hover:bg-ink-100"
            :aria-label="t('transcript.earlier')"
            @click="changeOffset(-OFFSET_STEP_SECONDS)"
          >
            -
          </button>
          <button
            class="w-16 text-center text-xs tabular-nums text-ink-800 hover:text-brand-600"
            :title="t('transcript.reset')"
            @click="emit('update:offset', 0)"
          >
            {{ formatOffset(offset) }}
          </button>
          <button
            class="h-7 w-7 rounded-md border border-ink-200 bg-white text-sm text-ink-700 hover:bg-ink-100"
            :aria-label="t('transcript.later')"
            @click="changeOffset(OFFSET_STEP_SECONDS)"
          >
            +
          </button>
        </div>
      </div>
    </header>

    <p v-if="!subtitles.length" class="p-6 text-center text-sm text-ink-500">
      {{ t('transcript.empty') }}
    </p>

    <ol v-else ref="listRef" class="relative min-h-0 flex-1 overflow-y-auto p-2">
      <li v-for="(subtitle, index) in subtitles" :key="`${subtitle.startTime}-${index}`" :data-index="index">
        <button
          class="flex w-full gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-ink-50"
          :class="index === activeIndex ? 'bg-brand-50' : ''"
          @click="emit('seek', subtitle)"
        >
          <span class="w-9 flex-shrink-0 pt-0.5 text-xs tabular-nums" :class="index === activeIndex ? 'text-brand-600' : 'text-ink-400'">
            {{ formatTime(subtitle.startTime) }}
          </span>
          <span class="whitespace-pre-line text-sm leading-snug" :class="index === activeIndex ? 'text-ink-900' : 'text-ink-700'">
            {{ subtitle.text }}
          </span>
        </button>
      </li>
    </ol>
    </div>
  </section>
</template>
