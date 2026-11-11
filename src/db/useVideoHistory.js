// État partagé et réactif de l'historique des vidéos traitées, consommé
// à la fois par VideoPlayer (qui écrit) et VideoHistory (qui affiche).
// Un simple module singleton suffit ici : pas besoin de Pinia pour un
// seul état partagé entre deux composants.

import { ref } from 'vue'
import { getAllProcessedVideos, deleteProcessedVideo } from './subtitles-store.js'

const entries = ref([])

async function refresh() {
  entries.value = await getAllProcessedVideos()
}

async function remove(fingerprint) {
  await deleteProcessedVideo(fingerprint)
  await refresh()
}

export function useVideoHistory() {
  return { entries, refresh, remove }
}
