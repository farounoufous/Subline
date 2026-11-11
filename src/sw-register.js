// Enregistre le service worker qui met en cache l'app shell.
// Volontairement désactivé en développement : Vite régénère ses
// fichiers (dont le client HMR) à chaque session, et un cache-first
// dessus provoque des incohérences. Le mode hors-ligne n'a de sens
// qu'une fois l'application buildée pour de vrai.
export function registerServiceWorker() {
  if (!import.meta.env.PROD) {
    return
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('Service worker non supporté par ce navigateur : le mode hors-ligne sera indisponible.')
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .catch((error) => {
        console.error('Échec de l\'enregistrement du service worker :', error)
      })
  })
}
