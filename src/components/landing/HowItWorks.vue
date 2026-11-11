<script setup>
import AppIcon from '../ui/AppIcon.vue'

const steps = [
  {
    icon: 'upload',
    title: 'Déposez votre vidéo',
    text: 'Choisissez un fichier sur votre appareil. Il n\'est jamais envoyé sur Internet : il est lu directement par votre navigateur.'
  },
  {
    icon: 'language',
    title: 'Indiquez la langue',
    text: 'Vidéo en anglais : simple transcription. Autre langue : l\'IA traduit directement la parole en anglais.'
  },
  {
    icon: 'play',
    title: 'Regardez avec les sous-titres',
    text: 'Dès quelques minutes de contenu prêtes, la lecture est débloquée pendant que la suite se génère en arrière-plan.'
  }
]
</script>

<template>
  <section id="fonctionnement" class="border-y border-ink-100 bg-ink-50/60 py-20">
    <div class="mx-auto max-w-6xl px-6">
      <p class="eyebrow">Fonctionnement</p>
      <h2 class="section-title mt-2">Trois étapes, aucun compte.</h2>
      <p class="section-lead">Pas d'inscription, pas de serveur, pas de limite de durée imposée par un abonnement.</p>

      <ol class="mt-12 grid gap-6 md:grid-cols-3">
        <li v-for="(step, index) in steps" :key="step.title" class="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
          <div class="flex items-center justify-between">
            <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <AppIcon :name="step.icon" class="h-5 w-5" />
            </span>
            <span class="text-sm font-medium tabular-nums text-ink-400">0{{ index + 1 }}</span>
          </div>
          <h3 class="mt-5 text-lg font-semibold text-ink-900">{{ step.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-ink-600">{{ step.text }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
