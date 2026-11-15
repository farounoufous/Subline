<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { quota, refreshQuota } from '../online/quota.js'
import { t } from '../i18n/index.js'

// Seule la limite quotidienne est affichée : c'est celle qui décide du
// nombre de fichiers que l'on peut encore traiter. La limite horaire ne
// remonte que lorsqu'elle est sur le point de bloquer.
const HOUR_WARNING_RATIO = 0.9
const WARN_RATIO = 0.7
const CRITICAL_RATIO = 0.9

let timer = null
onMounted(() => {
  refreshQuota()
  // La fenêtre glissante se vide avec le temps : on recalcule régulièrement.
  timer = setInterval(refreshQuota, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return t('quota.durationM', { m: minutes })
  if (minutes === 0) return t('quota.durationH', { h: hours })
  return t('quota.durationHM', { h: hours, m: String(minutes).padStart(2, '0') })
}

const ratio = computed(() => Math.min(1, quota.usedDay / quota.limitDay))
const remaining = computed(() => Math.max(0, quota.limitDay - quota.usedDay))
const barClass = computed(() =>
  ratio.value >= CRITICAL_RATIO ? 'bg-red-500' : ratio.value >= WARN_RATIO ? 'bg-amber-500' : 'bg-brand-600'
)
const hourNearlyFull = computed(() => quota.usedHour / quota.limitHour >= HOUR_WARNING_RATIO)
</script>

<template>
  <div :title="t('quota.note')">
    <div class="flex items-baseline justify-between gap-3">
      <p class="text-sm font-medium text-ink-900">{{ t('quota.title') }}</p>
      <p class="text-sm tabular-nums text-ink-900">{{ t('quota.left', { time: formatDuration(remaining) }) }}</p>
    </div>

    <div
      class="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-200"
      role="progressbar"
      :aria-label="t('quota.title')"
      aria-valuemin="0"
      :aria-valuemax="Math.round(quota.limitDay / 60)"
      :aria-valuenow="Math.round(quota.usedDay / 60)"
    >
      <div class="h-full rounded-full transition-[width] duration-500" :class="barClass" :style="{ width: Math.round(ratio * 100) + '%' }"></div>
    </div>

    <p class="mt-1.5 text-xs tabular-nums text-ink-500">
      {{ t('quota.used', { used: formatDuration(quota.usedDay), limit: formatDuration(quota.limitDay) }) }}
    </p>
    <p v-if="hourNearlyFull" class="mt-1 text-xs text-amber-800" role="status">{{ t('quota.hourNear') }}</p>
  </div>
</template>
