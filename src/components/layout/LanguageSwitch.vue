<script setup>
import { locale, setLocale, SUPPORTED_LOCALES, t } from '../../i18n/index.js'
</script>

<template>
  <div class="flex items-center rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium" role="group" :aria-label="t('nav.language')">
    <button
      v-for="code in SUPPORTED_LOCALES"
      :key="code"
      type="button"
      class="rounded-md px-2.5 py-1 uppercase transition-colors"
      :class="locale === code ? 'bg-brand-600 text-white' : 'text-ink-600 hover:text-ink-900'"
      :aria-pressed="locale === code"
      @click="setLocale(code)"
    >
      {{ code }}
    </button>
  </div>
</template>
