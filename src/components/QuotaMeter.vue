<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import { quota, refreshQuota } from '../online/quota.js'
import { t } from '../i18n/index.js'

let timer = null
onMounted(() => {
  refreshQuota()
  // La fenêtre glissante se vide avec le temps : on recalcule régulièrement.
  timer = setInterval(refreshQuota, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

function percent(used, limit) {
  return Math.min(100, Math.round((used / limit) * 100))
}

const minutes = (seconds) => Math.round(seconds / 60)
</script>

<template>
  <div class="rounded-lg border border-ink-200 bg-white p-3">
    <p class="text-xs font-medium text-ink-900">{{ t('quota.title') }}</p>

    <div v-for="row in [
      { label: 'quota.hour', used: quota.usedHour, limit: quota.limitHour },
      { label: 'quota.day', used: quota.usedDay, limit: quota.limitDay }
    ]" :key="row.label" class="mt-2">
      <div class="flex items-center justify-between text-xs text-ink-600">
        <span>{{ t(row.label) }}</span>
        <span class="tabular-nums">{{ t('quota.minutes', { used: minutes(row.used), limit: minutes(row.limit) }) }}</span>
      </div>
      <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div
          class="h-full rounded-full transition-[width]"
          :class="percent(row.used, row.limit) >= 90 ? 'bg-red-500' : percent(row.used, row.limit) >= 70 ? 'bg-amber-500' : 'bg-brand-600'"
          :style="{ width: percent(row.used, row.limit) + '%' }"
        ></div>
      </div>
    </div>

    <p v-if="quota.requestsLeft !== null" class="mt-2 text-xs text-ink-600">
      {{ t('quota.requestsLeft', { count: quota.requestsLeft }) }}
    </p>
    <p class="mt-2 text-xs leading-relaxed text-ink-500">{{ t('quota.note') }}</p>
  </div>
</template>
