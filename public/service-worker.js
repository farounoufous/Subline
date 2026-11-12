// Service worker de l'app shell.
// Responsabilité unique à cette étape : rendre l'interface disponible
// hors-ligne. La mise en cache des poids du modèle IA (Whisper) est
// gérée séparément par transformers.js, pas ici.

const CACHE_NAME = 'app-shell-v5'

// Liste explicite plutôt que découverte dynamique : on sait exactement
// ce qui doit être disponible hors-ligne, pas de surprise au runtime.
const APP_SHELL_FILES = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
]

// Les fichiers lourds (runtimes WASM d'ONNX et de ffmpeg, modèle VAD)
// ne sont volontairement PAS pré-chargés ici : un simple visiteur de la
// page d'accueil n'a pas à télécharger des dizaines de Mo. Ils sont mis
// en cache à la demande, lors de la première génération de
// sous-titres, par le gestionnaire fetch ci-dessous.

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

  // Uniquement les fichiers de l'app elle-même : les poids du modèle
  // (Hugging Face) ont leur propre cache géré par transformers.js, les
  // dupliquer ici doublerait inutilement le stockage.
  if (new URL(event.request.url).origin !== self.location.origin) {
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
