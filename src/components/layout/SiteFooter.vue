<script setup>
import { t } from '../../i18n/index.js'
</script>

<template>
  <footer class="border-t border-ink-100 py-10">
    <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-ink-500 sm:flex-row">
      <p>{{ t('footer.left') }}</p>
      <p>{{ t('footer.right') }}</p>
    </div>
  </footer>
</template>
