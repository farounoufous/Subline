// Service worker de l'app shell.
// Responsabilité unique à cette étape : rendre l'interface disponible
// hors-ligne. La mise en cache des poids du modèle IA (Whisper) est
// gérée séparément par transformers.js, pas ici.

const CACHE_NAME = 'app-shell-v3'

// Liste explicite plutôt que découverte dynamique : on sait exactement
// ce qui doit être disponible hors-ligne, pas de surprise au runtime.
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/onnx-runtime/ort-wasm-simd-threaded.jsep.mjs',
  '/onnx-runtime/ort-wasm-simd-threaded.jsep.wasm',
  '/vad-assets/silero_vad_legacy.onnx',
  '/vad-assets/ort-wasm-simd-threaded.mjs',
  '/vad-assets/ort-wasm-simd-threaded.wasm'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  // Supprime uniquement les anciennes versions du cache de l'app shell.
  // Les autres caches (notamment celui des poids du modèle, géré par
  // transformers.js) ne nous appartiennent pas et doivent être conservés.
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith('app-shell-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  // Cache-first : on sert depuis le cache si disponible, sinon réseau.
  // On ne met en cache que les requêtes GET http(s) réussies : les
  // extensions navigateur (chrome-extension://, moz-extension://, etc.)
  // et autres schémas non standards ne sont pas cachables et feraient
  // échouer cache.put().
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse
          }

          const responseClone = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })

          return networkResponse
        })
        .catch(() => {
          return new Response('Contenu indisponible hors-ligne.', {
            status: 503,
            statusText: 'Service indisponible hors-ligne'
          })
        })
    })
  )
})
