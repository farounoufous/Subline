// Internationalisation minimale (français / anglais) : un dictionnaire par
// langue et une fonction t(clé, paramètres). La langue courante est
// réactive : tout composant qui appelle t() dans son template se met à
// jour quand elle change. Pas de bibliothèque externe pour deux langues.

import { ref, watch } from 'vue'
import { fr } from './fr.js'
import { en } from './en.js'

const STORAGE_KEY = 'subline:locale'
const DICTIONARIES = { fr, en }
export const SUPPORTED_LOCALES = ['fr', 'en']

function detectInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (SUPPORTED_LOCALES.includes(stored)) return stored
  } catch {
    // Stockage indisponible : on retombe sur la langue du navigateur.
  }
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export const locale = ref(detectInitialLocale())

watch(
  locale,
  (value) => {
    if (typeof document !== 'undefined') document.documentElement.lang = value
    try {
      localStorage.setItem(STORAGE_KEY, value)
    } catch {
      // Sans conséquence.
    }
  },
  { immediate: true }
)

export function setLocale(value) {
  if (SUPPORTED_LOCALES.includes(value)) locale.value = value
}

/**
 * Traduit une clé. Les paramètres remplacent les {nom} du texte. Une clé
 * absente de la langue courante retombe sur le français, puis sur la clé
 * elle-même (visible, donc facile à repérer pendant le développement).
 */
export function t(key, params = {}) {
  const dictionary = DICTIONARIES[locale.value] || fr
  const template = dictionary[key] ?? fr[key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}
