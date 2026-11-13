<script setup>
import AppIcon from '../ui/AppIcon.vue'
import { t } from '../../i18n/index.js'

const steps = [
  { icon: 'upload', key: 'step1' },
  { icon: 'language', key: 'step2' },
  { icon: 'play', key: 'step3' }
]

</script>

<template>
  <section id="fonctionnement" class="border-y border-ink-100 bg-ink-50/60 py-20">
    <div class="mx-auto max-w-6xl px-6">
      <p class="eyebrow">{{ t('how.eyebrow') }}</p>
      <h2 class="section-title mt-2">{{ t('how.title') }}</h2>
      <p class="section-lead">{{ t('how.lead') }}</p>

      <ol class="mt-12 grid gap-6 md:grid-cols-3">
        <li v-for="(step, index) in steps" :key="step.key" class="rounded-2xl border border-ink-200 bg-white p-6 shadow-card">
          <div class="flex items-center justify-between">
            <span class="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <AppIcon :name="step.icon" class="h-5 w-5" />
            </span>
            <span class="text-sm font-medium tabular-nums text-ink-400">0{{ index + 1 }}</span>
          </div>
          <h3 class="mt-5 text-lg font-semibold text-ink-900">{{ t('how.' + step.key + '.title') }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-ink-600">{{ t('how.' + step.key + '.text') }}</p>
        </li>
      </ol>
    </div>
  </section>
</template>
