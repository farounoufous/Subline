// Persistance des vidéos déjà traitées dans IndexedDB : sous-titres,
// miniature et métadonnées, indexés par l'empreinte du fichier.
//
// CACHE_FORMAT_VERSION : à incrémenter dès que la logique de génération
// change de façon incompatible (segmentation, modèle, découpage en
// lignes...). Les entrées d'une ancienne version sont ignorées plutôt
// que d'afficher des sous-titres produits par une logique périmée.

const DB_NAME = 'sous-titrage-local'
const DB_VERSION = 2
const STORE_NAME = 'processedVideos'
// Progression d'un traitement interrompu, segment par segment, pour
// pouvoir le reprendre sans tout recalculer.
const PARTIALS_STORE_NAME = 'partialProgress'
const CACHE_FORMAT_VERSION = 5

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fingerprint' })
      }
      if (!db.objectStoreNames.contains(PARTIALS_STORE_NAME)) {
        db.createObjectStore(PARTIALS_STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Exécute une opération sur le store et attend la fin de la transaction.
async function withStore(mode, operation, storeName = STORE_NAME) {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode)
      const store = transaction.objectStore(storeName)
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

// --- Progression partielle (reprise après interruption) ---

// Clé : empreinte du fichier + mode, car la progression d'une
// transcription n'est pas réutilisable pour une traduction.
export const partialKey = (fingerprint, mode) => `${fingerprint}::${mode}`

export async function getPartialProgress(key) {
  const entry = await withStore('readonly', (store) => store.get(key), PARTIALS_STORE_NAME)
  if (!entry || entry.formatVersion !== CACHE_FORMAT_VERSION) {
    return null
  }
  return entry
}

export async function savePartialProgress(key, segments) {
  const plain = JSON.parse(JSON.stringify({ key, segments, formatVersion: CACHE_FORMAT_VERSION, updatedAt: Date.now() }))
  await withStore('readwrite', (store) => store.put(plain), PARTIALS_STORE_NAME)
}

export async function deletePartialProgress(key) {
  await withStore('readwrite', (store) => store.delete(key), PARTIALS_STORE_NAME)
}
