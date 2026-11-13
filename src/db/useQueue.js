// File d'attente des fichiers à sous-titrer, persistante.
//
// Ce qui survit à un rechargement : la liste, l'état de chaque fichier et,
// sur Chrome/Edge (File System Access API), le "handle" qui permet de
// rouvrir le fichier d'un clic. Sans handle (Firefox, Safari, ou fichier
// glissé sans support), l'élément reste dans la liste et l'utilisateur
// le rechoisit : on le reconnaît à son empreinte (nom, taille, date).
//
// Les objets File eux-mêmes ne sont jamais stockés : ils vivent en
// mémoire pour la session en cours.

import { ref, computed } from 'vue'
import { computeFingerprint } from '../utils/fingerprint.js'
import { mediaKind } from '../utils/media-file.js'
import { getAllQueueItems, saveQueueItem, deleteQueueItem } from './subtitles-store.js'

const CURRENT_KEY = 'subline:current'

// status : 'pending' | 'processing' | 'done' | 'error'
const items = ref([])
const loaded = ref(false)
const files = new Map() // id -> File (session courante)
const fileVersion = ref(0) // force la mise à jour des états "fichier disponible"

function readCurrent() {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

const currentId = ref(readCurrent())

function persist(item) {
  // Les champs réactifs sont copiés : IndexedDB ne clone pas les proxys Vue.
  const { id, fingerprint, name, size, lastModified, kind, status, error, addedAt, handle } = item
  return saveQueueItem({ id, fingerprint, name, size, lastModified, kind, status, error, addedAt, handle }).catch((e) => {
    console.warn('Sauvegarde de la file impossible :', e.message)
  })
}

function setCurrent(id) {
  currentId.value = id
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id)
    else localStorage.removeItem(CURRENT_KEY)
  } catch {
    // Sans conséquence.
  }
}

async function grantedFile(handle, { ask }) {
  if (!handle) return null
  try {
    let permission = await handle.queryPermission({ mode: 'read' })
    if (permission !== 'granted' && ask) permission = await handle.requestPermission({ mode: 'read' })
    if (permission !== 'granted') return null
    return await handle.getFile()
  } catch {
    // Fichier déplacé ou supprimé, ou permission refusée.
    return null
  }
}

/** À appeler une fois au démarrage : recharge la file et rouvre ce qui peut l'être sans geste. */
async function load() {
  if (loaded.value) return
  try {
    const rows = await getAllQueueItems()
    items.value = rows
      .map((row) => ({ ...row, status: row.status === 'processing' ? 'pending' : row.status }))
      .sort((a, b) => a.addedAt - b.addedAt)

    // Les fichiers dont le navigateur a gardé l'autorisation se rouvrent seuls.
    await Promise.all(
      items.value.map(async (item) => {
        const file = await grantedFile(item.handle, { ask: false })
        if (file) files.set(item.id, file)
      })
    )
    fileVersion.value++
  } catch (error) {
    console.warn('Lecture de la file impossible :', error.message)
  }
  loaded.value = true
}

/** Ajoute un fichier (avec son handle si disponible). Renvoie l'élément (existant ou nouveau). */
function add(file, handle = null) {
  const kind = mediaKind(file)
  if (!kind) return null

  const id = computeFingerprint(file)
  files.set(id, file)
  fileVersion.value++

  const existing = items.value.find((item) => item.id === id)
  if (existing) {
    if (handle) existing.handle = handle
    persist(existing)
    return existing
  }

  const item = {
    id,
    fingerprint: id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    kind,
    status: 'pending',
    error: null,
    addedAt: Date.now(),
    handle
  }
  items.value.push(item)
  persist(item)
  return item
}

function setStatus(id, status, error = null) {
  const item = items.value.find((entry) => entry.id === id)
  if (!item) return
  item.status = status
  item.error = error
  persist(item)
}

function remove(id) {
  items.value = items.value.filter((item) => item.id !== id)
  files.delete(id)
  fileVersion.value++
  if (currentId.value === id) setCurrent(null)
  deleteQueueItem(id).catch(() => {})
}

function clearDone() {
  for (const item of items.value.filter((entry) => entry.status === 'done')) remove(item.id)
}

const fileFor = (id) => files.get(id) || null

/** Réouverture déclenchée par un clic (la permission peut être redemandée). */
async function reopen(id) {
  const item = items.value.find((entry) => entry.id === id)
  const file = item ? await grantedFile(item.handle, { ask: true }) : null
  if (file) {
    files.set(id, file)
    fileVersion.value++
  }
  return file
}

/** Un fichier choisi à la main correspond-il à un élément restauré ? */
function matchRestored(file) {
  return items.value.find((item) => item.id === computeFingerprint(file)) || null
}

export function useQueue() {
  const hasFile = (id) => {
    fileVersion.value // dépendance réactive
    return files.has(id)
  }
  const pendingCount = computed(() => items.value.filter((item) => item.status === 'pending' || item.status === 'error').length)

  return { items, currentId, pendingCount, load, add, setStatus, remove, clearDone, fileFor, hasFile, reopen, matchRestored, setCurrent }
}
