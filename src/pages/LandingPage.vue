<script setup>
import { watchEffect } from 'vue'
import { t } from '../i18n/index.js'
import SiteHeader from '../components/layout/SiteHeader.vue'
import SiteFooter from '../components/layout/SiteFooter.vue'
import HeroSection from '../components/landing/HeroSection.vue'
import HowItWorks from '../components/landing/HowItWorks.vue'
import FeatureGrid from '../components/landing/FeatureGrid.vue'
import FaqSection from '../components/landing/FaqSection.vue'

watchEffect(() => {
  document.title = t('meta.landingTitle')
})
</script>

<template>
  <div class="min-h-screen bg-white">
    <SiteHeader mode="landing" />
    <main>
      <HeroSection />
      <HowItWorks />
      <FeatureGrid />
      <FaqSection />
    </main>
    <SiteFooter />
  </div>
</template>
