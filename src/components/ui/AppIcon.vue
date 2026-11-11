<script setup>
// Icônes en SVG en ligne (style trait, 24x24) : pas de dépendance
// externe ni d'emoji, et elles héritent de la couleur du texte.
defineProps({
  name: { type: String, required: true }
})

const PATHS = {
  shield: 'M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6l-8-3Zm-3 9 2 2 4-4',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-3-2M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01',
  language: 'M4 5h8M8 3v2M5.5 5c.6 3.5 3 6 6 7M10.5 5c-.6 3.5-3 6-6 7M13 20l4-9 4 9M14.5 17h5',
  download: 'M12 4v11m0 0 4-4m-4 4-4-4M5 20h14',
  upload: 'M12 16V5m0 0 4 4m-4-4-4 4M5 20h14',
  play: 'M8 5.5v13l11-6.5-11-6.5Z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  history: 'M4 12a8 8 0 1 0 2.5-5.8L4 8.5M4 4v4.5h4.5M12 8v4l3 2',
  check: 'M5 12.5 10 17.5 19 7.5',
  film: 'M4 5h16v14H4V5Zm4 0v14m8-14v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4',
  chip: 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 7h10v10H7V7Zm3 3h4v4h-4v-4Z',
  lines: 'M4 7h16M4 12h10M4 17h13',
  trash: 'M5 7h14M10 11v6m4-6v6M6 7l1 12h10l1-12M9 7V4h6v3',
  fullscreen: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3m13 5h3a2 2 0 0 0 2-2v-3',
  exitFullscreen: 'M9 3v3a2 2 0 0 1-2 2H4m11-5v3a2 2 0 0 0 2 2h3M9 21v-3a2 2 0 0 0-2-2H4m11 5v-3a2 2 0 0 1 2-2h3',
  chevron: 'm6 9 6 6 6-6',
  arrowRight: 'M5 12h14m0 0-5-5m5 5-5 5'
}
</script>

<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="PATHS[name]" />
  </svg>
</template>
