// Service worker de l'app shell.
// Responsabilité unique à cette étape : rendre l'interface disponible
// hors-ligne. La mise en cache des poids du modèle IA (Whisper) est
// gérée séparément par transformers.js, pas ici.

const CACHE_NAME = 'app-shell-v10-1'
const RUNTIME_CACHE_NAME = 'subline-runtime-v1'

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
  // Les autres caches (runtimes lourds, poids du modèle géré par
  // transformers.js) doivent être conservés.
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

// Chemins des runtimes WASM lourds (ONNX, ffmpeg, modèle VAD) : ils ne
// changent qu'avec une mise à jour de ces bibliothèques. Ils vivent dans
// un cache SÉPARÉ et permanent, que les mises à jour de l'app ne vident
// jamais : sinon chaque déploiement ferait retélécharger ~55 Mo.
// Si un de ces fichiers change vraiment, incrémenter RUNTIME_CACHE_NAME.
const HEAVY_RUNTIME_PREFIXES = ['/onnx-runtime/', '/ffmpeg/', '/vad-assets/']

function isHeavyRuntimeRequest(url) {
  return HEAVY_RUNTIME_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response && response.status === 200) {
    const clone = response.clone()
    caches.open(cacheName).then((cache) => cache.put(request, clone))
  }
  return response
}

// Pages HTML : réseau d'abord, pour qu'un nouveau déploiement soit pris
// en compte dès la visite suivante (sans cela, un cache-first garderait
// l'ancienne version indéfiniment). Hors ligne, on retombe sur le cache.
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response && response.status === 200) {
      const clone = response.clone()
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
    }
    return response
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return new Response('Contenu indisponible hors-ligne.', { status: 503, statusText: 'Service indisponible hors-ligne' })
  }
}

self.addEventListener('fetch', (event) => {
  // On ne gère que les requêtes GET http(s) : les extensions navigateur
  // (chrome-extension://...) ne sont pas cachables et feraient échouer
  // cache.put().
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return
  }

  const url = new URL(event.request.url)

  // Uniquement les fichiers de l'app elle-même : les poids du modèle
  // (Hugging Face) ont leur propre cache géré par transformers.js, les
  // dupliquer ici doublerait inutilement le stockage.
  if (url.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request))
  } else if (isHeavyRuntimeRequest(url)) {
    event.respondWith(cacheFirst(event.request, RUNTIME_CACHE_NAME).catch(() => new Response('', { status: 503 })))
  } else {
    // Fichiers versionnés par leur nom (assets/xxx-HASH.js) : cache-first.
    event.respondWith(cacheFirst(event.request, CACHE_NAME).catch(() => new Response('', { status: 503 })))
  }
})
