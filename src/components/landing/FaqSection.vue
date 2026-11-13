<script setup>
import AppIcon from '../ui/AppIcon.vue'
import { MODEL_DOWNLOAD_SIZE_LABEL } from '../../audio/constants.js'
import { t } from '../../i18n/index.js'

const questionKeys = [1, 2, 3, 4, 5]

</script>

<template>
  <section id="faq" class="border-t border-ink-100 bg-ink-50/60 py-20">
    <div class="mx-auto max-w-3xl px-6">
      <p class="eyebrow">{{ t('faq.eyebrow') }}</p>
      <h2 class="section-title mt-2">{{ t('faq.title') }}</h2>

      <div class="mt-10 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-white shadow-card">
        <details v-for="n in questionKeys" :key="n" class="group px-6 py-5">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
            {{ t('faq.q' + n) }}
            <AppIcon name="chevron" class="h-5 w-5 flex-shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
          </summary>
          <p class="mt-3 text-sm leading-relaxed text-ink-600">{{ t('faq.a' + n, { size: MODEL_DOWNLOAD_SIZE_LABEL }) }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
