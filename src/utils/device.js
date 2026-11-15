// Détection grossière des appareils limités (téléphones, machines à peu de
// mémoire ou de cœurs), pour éviter de leur imposer le mode Local sans
// avertissement : le modèle Whisper y est très lent, voire provoque un
// manque de mémoire. Aucune donnée n'est envoyée ni conservée.

const LOW_MEMORY_GB = 4
const LOW_CORE_COUNT = 2

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
    return navigator.userAgentData.mobile
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
}

/** @returns {{ mobile: boolean, limited: boolean }} */
export function detectDevice() {
  const mobile = isMobileBrowser()
  // deviceMemory n'existe que sous Chrome/Edge ; absent = on ne conclut rien.
  const lowMemory = typeof navigator !== 'undefined' && navigator.deviceMemory !== undefined && navigator.deviceMemory <= LOW_MEMORY_GB
  const fewCores = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency || 4) <= LOW_CORE_COUNT
  return { mobile, limited: mobile || lowMemory || fewCores }
}

export const isTouchDevice = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
