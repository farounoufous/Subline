<script setup>
import AppIcon from './ui/AppIcon.vue'
import { t } from '../i18n/index.js'

defineProps({
  items: { type: Array, required: true },
  currentId: { type: String, default: null },
  running: { type: Boolean, default: false },
  hasFile: { type: Function, required: true }
})

defineEmits(['select', 'remove', 'clear-done', 'reopen', 'add', 'stop'])

function formatSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} Go`
  return `${Math.max(1, Math.round(bytes / 1e6))} Mo`
}

const STATUS_CLASSES = {
  pending: 'bg-ink-100 text-ink-700',
  processing: 'bg-brand-50 text-brand-700',
  done: 'bg-emerald-100 text-emerald-800',
  error: 'bg-red-100 text-red-700'
}
</script>

<template>
  <section class="rounded-2xl border border-ink-200 bg-white p-5 shadow-card" data-testid="queue">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <AppIcon name="lines" class="h-4 w-4 text-ink-500" />
        <h3 class="text-sm font-semibold text-ink-900">{{ t('queue.title') }}</h3>
        <span class="text-xs text-ink-400">{{ items.length === 1 ? t('queue.countOne') : t('queue.count', { count: items.length }) }}</span>
      </div>
      <div class="flex items-center gap-3 text-sm">
        <button v-if="running" class="text-red-600 hover:text-red-700" @click="$emit('stop')">{{ t('queue.stop') }}</button>
        <button v-if="items.some((item) => item.status === 'done')" class="text-ink-500 hover:text-ink-800" @click="$emit('clear-done')">
          {{ t('queue.clearDone') }}
        </button>
        <button class="text-brand-600 hover:text-brand-700" @click="$emit('add')">{{ t('player.addFiles') }}</button>
      </div>
    </div>

    <p v-if="!items.length" class="mt-4 rounded-xl bg-ink-50 px-3 py-5 text-center text-xs text-ink-500">{{ t('queue.empty') }}</p>

    <ul v-else class="mt-3 divide-y divide-ink-100">
      <li v-for="item in items" :key="item.id" class="flex flex-wrap items-center gap-3 py-2.5" :data-id="item.id">
        <button
          class="min-w-0 flex-1 text-left disabled:cursor-default"
          :disabled="running"
          @click="$emit('select', item.id)"
        >
          <p class="truncate text-sm" :class="item.id === currentId ? 'font-semibold text-brand-700' : 'font-medium text-ink-900'" :title="item.name">
            {{ item.name }}
          </p>
          <p class="text-xs text-ink-500">
            {{ formatSize(item.size) }}
            <span v-if="item.error" class="text-red-600"> &middot; {{ item.error }}</span>
          </p>
        </button>

        <span
          v-if="item.status !== 'done' && item.status !== 'processing' && !hasFile(item.id)"
          class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
        >
          {{ t('queue.status.needsFile') }}
        </span>
        <span v-else class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS_CLASSES[item.status]">
          {{ t('queue.status.' + item.status) }}
        </span>

        <button
          v-if="!hasFile(item.id)"
          class="text-xs text-brand-600 hover:text-brand-700"
          @click="$emit('reopen', item.id)"
        >
          {{ t('queue.reopen') }}
        </button>

        <button
          class="text-ink-400 hover:text-red-600 disabled:opacity-40"
          :disabled="running"
          :aria-label="t('queue.remove')"
          :title="t('queue.remove')"
          @click="$emit('remove', item.id)"
        >
          <AppIcon name="trash" class="h-4 w-4" />
        </button>
      </li>
    </ul>
  </section>
</template>
