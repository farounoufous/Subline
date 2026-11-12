<script setup>
import { onMounted } from 'vue'
import { useVideoHistory } from '../db/useVideoHistory.js'
import AppIcon from './ui/AppIcon.vue'

const { entries, refresh, remove } = useVideoHistory()

onMounted(() => {
  refresh().catch((error) => {
    console.warn('Lecture de l\'historique impossible :', error.message)
  })
})

function formatDuration(seconds) {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${minutes}:${rest}`
}
</script>

<template>
  <aside class="rounded-2xl border border-ink-200 bg-white p-5 shadow-card">
    <div class="flex items-center gap-2">
      <AppIcon name="history" class="h-4 w-4 text-ink-500" />
      <h3 class="text-sm font-semibold text-ink-900">Vidéos déjà sous-titrées</h3>
    </div>
    <p class="mt-1 text-xs leading-relaxed text-ink-500">
      Redéposez l'une de ces vidéos : ses sous-titres sont restaurés instantanément.
    </p>

    <p v-if="!entries.length" class="mt-6 rounded-xl bg-ink-50 px-3 py-6 text-center text-xs text-ink-500">
      Aucune pour l'instant.
    </p>

    <ul class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <li v-for="entry in entries" :key="entry.fingerprint" class="overflow-hidden rounded-xl border border-ink-200">
        <img v-if="entry.thumbnailDataUrl" :src="entry.thumbnailDataUrl" alt="" class="aspect-video w-full bg-ink-100 object-cover" />
        <div class="flex flex-col gap-1 p-3">
          <p class="truncate text-sm font-medium text-ink-900" :title="entry.fileName">{{ entry.fileName }}</p>
          <div class="flex items-center justify-between text-xs text-ink-500">
            <span class="tabular-nums">{{ formatDuration(entry.durationSeconds) }}</span>
            <button class="flex items-center gap-1 hover:text-red-600" @click="remove(entry.fingerprint)">
              <AppIcon name="trash" class="h-3.5 w-3.5" />
              Supprimer
            </button>
          </div>
        </div>
      </li>
    </ul>
  </aside>
</template>
