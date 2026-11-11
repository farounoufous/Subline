<script setup>
import AppIcon from '../ui/AppIcon.vue'
import { MODEL_DOWNLOAD_SIZE_LABEL } from '../../audio/constants.js'

const questions = [
  {
    question: 'Mes vidéos sont-elles envoyées quelque part ?',
    answer: 'Non. Le traitement se fait entièrement dans votre navigateur. La seule connexion nécessaire sert à télécharger le modèle d\'IA, une fois.'
  },
  {
    question: 'Que télécharge l\'application au premier usage ?',
    answer: `Le modèle de reconnaissance vocale Whisper, environ ${MODEL_DOWNLOAD_SIZE_LABEL}. Il est conservé par le navigateur : les fois suivantes, tout fonctionne sans connexion.`
  },
  {
    question: 'Pourquoi uniquement des sous-titres en anglais ?',
    answer: 'Whisper sait traduire directement la parole vers l\'anglais avec une bonne fiabilité. Cela évite un second modèle de traduction, plus lourd et moins précis.'
  },
  {
    question: 'Combien de temps faut-il pour sous-titrer une vidéo ?',
    answer: 'Cela dépend de votre processeur. La lecture se débloque dès environ 4 minutes de contenu prêtes ; le reste continue en arrière-plan. Les vidéos déjà traitées sont restaurées instantanément.'
  },
  {
    question: 'Peut-on l\'utiliser sur téléphone ?',
    answer: 'L\'application est conçue pour ordinateur. Le modèle demande de la mémoire et de la puissance de calcul qu\'un téléphone n\'offre pas toujours.'
  }
]
</script>

<template>
  <section id="faq" class="border-t border-ink-100 bg-ink-50/60 py-20">
    <div class="mx-auto max-w-3xl px-6">
      <p class="eyebrow">FAQ</p>
      <h2 class="section-title mt-2">Questions fréquentes</h2>

      <div class="mt-10 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white shadow-card">
        <details v-for="item in questions" :key="item.question" class="group px-6 py-5">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
            {{ item.question }}
            <AppIcon name="chevron" class="h-5 w-5 flex-shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
          </summary>
          <p class="mt-3 text-sm leading-relaxed text-ink-600">{{ item.answer }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
