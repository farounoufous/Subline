<script setup>
import AppIcon from '../ui/AppIcon.vue'
import { t } from '../../i18n/index.js'

const features = [
  { icon: 'shield', key: 'f1' },
  { icon: 'wifiOff', key: 'f2' },
  { icon: 'language', key: 'f3' },
  { icon: 'film', key: 'f4' },
  { icon: 'history', key: 'f5' },
  { icon: 'download', key: 'f6' }
]

</script>

<template>
  <section id="fonctionnalites" class="py-20">
    <div class="mx-auto max-w-6xl px-6">
      <p class="eyebrow">{{ t('features.eyebrow') }}</p>
      <h2 class="section-title mt-2">{{ t('features.title') }}</h2>
      <p class="section-lead">{{ t('features.lead') }}</p>

      <div class="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="feature in features" :key="feature.key" class="flex gap-4">
          <span class="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <AppIcon :name="feature.icon" class="h-5 w-5" />
          </span>
          <div>
            <h3 class="font-semibold text-ink-900">{{ t('features.' + feature.key + '.title') }}</h3>
            <p class="mt-1.5 text-sm leading-relaxed text-ink-600">{{ t('features.' + feature.key + '.text') }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
