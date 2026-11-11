// Persistance des vidéos déjà traitées dans IndexedDB : sous-titres,
// miniature et métadonnées, indexés par l'empreinte du fichier.
//
// CACHE_FORMAT_VERSION : à incrémenter dès que la logique de génération
// change de façon incompatible (segmentation, modèle, découpage en
// lignes...). Les entrées d'une ancienne version sont ignorées plutôt
// que d'afficher des sous-titres produits par une logique périmée.

const DB_NAME = 'sous-titrage-local'
const DB_VERSION = 1
const STORE_NAME = 'processedVideos'
const CACHE_FORMAT_VERSION = 4

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Exécute une opération sur le store et attend la fin de la transaction.
async function withStore(mode, operation) {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      const request = operation(store)

      transaction.oncomplete = () => resolve(request?.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export async function getProcessedVideo(fingerprint) {
  const entry = await withStore('readonly', (store) => store.get(fingerprint))
  if (!entry || entry.formatVersion !== CACHE_FORMAT_VERSION) {
    return null
  }
  return entry
}

export async function saveProcessedVideo(entry) {
  // Copie "brute" : les tableaux réactifs de Vue ne sont pas clonables
  // tels quels par IndexedDB (structured clone).
  const plainEntry = JSON.parse(JSON.stringify({ ...entry, formatVersion: CACHE_FORMAT_VERSION }))
  await withStore('readwrite', (store) => store.put(plainEntry))
}

export async function getAllProcessedVideos() {
  const entries = await withStore('readonly', (store) => store.getAll())
  return (entries || [])
    .filter((entry) => entry.formatVersion === CACHE_FORMAT_VERSION)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteProcessedVideo(fingerprint) {
  await withStore('readwrite', (store) => store.delete(fingerprint))
}
