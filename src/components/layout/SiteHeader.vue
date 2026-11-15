<script setup>
import AppIcon from '../ui/AppIcon.vue'
import LanguageSwitch from './LanguageSwitch.vue'
import { t } from '../../i18n/index.js'

defineProps({
  // 'landing' : navigation par sections + accès à l'application.
  // 'app' : retour à l'accueil.
  mode: { type: String, default: 'landing' }
})

const links = [
  { key: 'nav.how', href: '/#fonctionnement' },
  { key: 'nav.features', href: '/#fonctionnalites' },
  { key: 'nav.faq', href: '/#faq' }
]
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-ink-100 bg-white/80 backdrop-blur">
    <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
      <a href="/" class="flex items-center gap-2.5 text-ink-900">
        <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <AppIcon name="lines" class="h-4 w-4" />
        </span>
        <span class="text-base font-semibold tracking-tight">Subline</span>
      </a>

      <nav v-if="mode === 'landing'" class="hidden items-center gap-8 md:flex" :aria-label="t('nav.main')">
        <a
          v-for="link in links"
          :key="link.href"
          :href="link.href"
          class="text-sm text-ink-600 transition-colors hover:text-ink-900"
        >
          {{ t(link.key) }}
        </a>
      </nav>

      <div class="flex items-center gap-2 sm:gap-3">
        <LanguageSwitch />
        <a v-if="mode === 'landing'" href="/app.html" class="btn-primary !px-4 !py-2 whitespace-nowrap">
          <span class="sm:hidden">{{ t('nav.openAppShort') }}</span>
          <span class="hidden sm:inline">{{ t('nav.openApp') }}</span>
        </a>
        <a v-else href="/" class="btn-secondary !px-4 !py-2 whitespace-nowrap">
          <span class="sm:hidden">{{ t('nav.backHomeShort') }}</span>
          <span class="hidden sm:inline">{{ t('nav.backHome') }}</span>
        </a>
      </div>
    </div>
  </header>
</template>
