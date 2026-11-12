<script setup>
import AppIcon from '../ui/AppIcon.vue'

const badges = ['100% local', 'Fonctionne hors ligne', 'Aucun envoi de données']
</script>

<template>
  <section class="relative overflow-hidden">
    <div
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-gradient-to-b from-brand-50 via-white to-white"
      aria-hidden="true"
    ></div>

    <div class="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
      <div class="mx-auto max-w-3xl text-center">
        <p class="eyebrow">Sous-titrage automatique, entièrement dans votre navigateur</p>
        <h1 class="mt-4 text-4xl font-semibold tracking-tight text-ink-900 sm:text-6xl">
          Des sous-titres anglais pour toutes vos vidéos.
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-lg text-ink-600">
          Déposez une vidéo : l'intelligence artificielle l'écoute sur votre appareil, la transcrit
          ou la traduit en anglais, et affiche les sous-titres en synchronisation. Rien ne quitte votre ordinateur.
        </p>

        <div class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href="/app.html" class="btn-primary px-6 py-3">
            Sous-titrer une vidéo
            <AppIcon name="arrowRight" class="h-4 w-4" />
          </a>
          <a href="#fonctionnement" class="btn-secondary px-6 py-3">Voir comment ça marche</a>
        </div>

        <ul class="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ink-500">
          <li v-for="badge in badges" :key="badge" class="flex items-center gap-1.5">
            <AppIcon name="check" class="h-4 w-4 text-brand-600" />
            {{ badge }}
          </li>
        </ul>
      </div>

      <!-- Aperçu illustratif du lecteur (maquette statique, pas une vraie vidéo). -->
      <div class="mx-auto mt-16 max-w-4xl rounded-2xl border border-ink-200 bg-white p-2 shadow-card">
        <div class="relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br from-ink-800 via-ink-900 to-brand-900">
          <div class="absolute inset-0 opacity-30" style="background: radial-gradient(circle at 30% 20%, rgb(129 140 248 / 0.5), transparent 55%)"></div>

          <div class="absolute inset-x-0 bottom-[16%] flex justify-center px-6">
            <p class="bg-black px-3 py-1.5 text-center text-sm font-medium text-white sm:text-xl">
              So let's say that we now have two variables,<br class="hidden sm:block" />
              first the name and then the age.
            </p>
          </div>

          <div class="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-5 pb-4 pt-8">
            <AppIcon name="play" class="h-5 w-5 text-white" />
            <div class="h-1 flex-1 rounded-full bg-white/25">
              <div class="h-1 w-1/3 rounded-full bg-brand-400"></div>
            </div>
            <span class="text-xs tabular-nums text-white/80">01:12</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
