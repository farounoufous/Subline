import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})
