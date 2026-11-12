<script setup>
import AppIcon from '../ui/AppIcon.vue'

defineProps({
  // 'landing' : navigation par sections + accès à l'application.
  // 'app' : retour à l'accueil.
  mode: { type: String, default: 'landing' }
})

const links = [
  { label: 'Fonctionnement', href: '/#fonctionnement' },
  { label: 'Fonctionnalités', href: '/#fonctionnalites' },
  { label: 'FAQ', href: '/#faq' }
]
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-ink-100 bg-white/80 backdrop-blur">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
      <a href="/" class="flex items-center gap-2.5 text-ink-900">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <AppIcon name="lines" class="h-4 w-4" />
        </span>
        <span class="text-base font-semibold tracking-tight">Subline</span>
      </a>

      <nav v-if="mode === 'landing'" class="hidden items-center gap-8 md:flex" aria-label="Navigation principale">
        <a
          v-for="link in links"
          :key="link.href"
          :href="link.href"
          class="text-sm text-ink-600 transition-colors hover:text-ink-900"
        >
          {{ link.label }}
        </a>
      </nav>

      <a v-if="mode === 'landing'" href="/app.html" class="btn-primary !px-4 !py-2">Ouvrir l'application</a>
      <a v-else href="/" class="btn-secondary !px-4 !py-2">Retour à l'accueil</a>
    </div>
  </header>
</template>
