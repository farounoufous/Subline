<script setup>
import SiteHeader from './components/layout/SiteHeader.vue'
import SiteFooter from './components/layout/SiteFooter.vue'
import HeroSection from './components/landing/HeroSection.vue'
import HowItWorks from './components/landing/HowItWorks.vue'
import FeatureGrid from './components/landing/FeatureGrid.vue'
import FaqSection from './components/landing/FaqSection.vue'
import VideoPlayer from './components/VideoPlayer.vue'
import VideoHistory from './components/VideoHistory.vue'
</script>

<template>
  <div class="min-h-screen bg-white">
    <SiteHeader />

    <main>
      <HeroSection />

      <section id="application" class="mx-auto max-w-6xl px-6 pb-24">
        <div class="mb-8">
          <p class="eyebrow">Application</p>
          <h2 class="section-title mt-2">Sous-titrez votre vidéo</h2>
        </div>

        <div class="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <VideoPlayer />
          <VideoHistory />
        </div>
      </section>

      <HowItWorks />
      <FeatureGrid />
      <FaqSection />
    </main>

    <SiteFooter />
  </div>
</template>
