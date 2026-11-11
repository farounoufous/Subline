<script setup>
import AppIcon from '../ui/AppIcon.vue'

const features = [
  { icon: 'shield', title: 'Confidentialité totale', text: 'Le son est analysé sur votre appareil. Aucune vidéo, aucun texte ni aucune statistique n\'est transmis.' },
  { icon: 'wifiOff', title: 'Utilisable hors ligne', text: 'Le modèle est téléchargé une seule fois, puis l\'application fonctionne sans aucune connexion.' },
  { icon: 'language', title: 'Anglais ou traduction', text: 'Transcription directe d\'une vidéo anglaise, ou traduction vers l\'anglais depuis de nombreuses autres langues.' },
  { icon: 'clock', title: 'Synchronisation précise', text: 'Chaque mot est horodaté : les sous-titres apparaissent quand la phrase est prononcée.' },
  { icon: 'lines', title: 'Lisibles par conception', text: 'Lignes courtes, deux lignes maximum, durée d\'affichage et vitesse de lecture respectées.' },
  { icon: 'download', title: 'Export SRT et VTT', text: 'Téléchargez vos sous-titres pour les réutiliser dans un autre lecteur ou un éditeur vidéo.' }
]
</script>

<template>
  <section id="fonctionnalites" class="py-20">
    <div class="mx-auto max-w-6xl px-6">
      <p class="eyebrow">Fonctionnalités</p>
      <h2 class="section-title mt-2">Pensé pour la qualité et la discrétion.</h2>
      <p class="section-lead">Un outil simple en surface, rigoureux dans le détail.</p>

      <div class="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="feature in features" :key="feature.title" class="flex gap-4">
          <span class="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <AppIcon :name="feature.icon" class="h-5 w-5" />
          </span>
          <div>
            <h3 class="font-semibold text-ink-900">{{ feature.title }}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-ink-600">{{ feature.text }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
