<script setup>
import SiteHeader from '../components/layout/SiteHeader.vue'
import VideoPlayer from '../components/VideoPlayer.vue'
import VideoHistory from '../components/VideoHistory.vue'
</script>

<template>
  <div class="min-h-screen bg-ink-50/60">
    <SiteHeader mode="app" />
    <main class="mx-auto max-w-6xl px-6 py-8">
      <VideoPlayer />
      <VideoHistory class="mt-6" />
    </main>
  </div>
</template>
