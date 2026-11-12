import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// En-têtes d'isolation cross-origin : nécessaires pour que le runtime
// WASM d'ONNX (utilisé par Whisper et le VAD) puisse tourner en vrai
// multi-thread. En production, l'équivalent est dans vercel.json.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  plugins: [vue()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  // ffmpeg.wasm crée son propre worker : Vite ne doit pas le pré-bundler.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Deux pages : la landing (index.html) et l'application (app.html).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        app: fileURLToPath(new URL('./app.html', import.meta.url))
      }
    }
  }
})
