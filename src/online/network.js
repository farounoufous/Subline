// État de la connexion pendant un appel en ligne, pour l'afficher à
// l'utilisateur : nouvelle tentative en cours (avec compte à rebours) ou
// appareil hors connexion (attente du retour du réseau).

import { reactive } from 'vue'

// Délais (secondes) avant chaque nouvelle tentative : environ 1 min 40 au
// total avant d'abandonner, ce qui absorbe une coupure brève sans bloquer
// l'utilisateur plusieurs minutes si le réseau est réellement tombé.
export const NETWORK_RETRY_DELAYS = [2, 5, 10, 20, 30, 30]

// state : 'ok' | 'retrying' | 'offline'
export const network = reactive({ state: 'ok', attempt: 0, maxAttempts: NETWORK_RETRY_DELAYS.length, seconds: 0 })

export function clearNetworkNotice() {
  network.state = 'ok'
  network.attempt = 0
  network.seconds = 0
}

function abortError() {
  return new DOMException('Annulé', 'AbortError')
}

/** Attend `seconds` en mettant à jour le compte à rebours chaque seconde. */
export function waitWithCountdown(seconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    let remaining = Math.ceil(seconds)
    network.seconds = remaining
    const timer = setInterval(() => {
      remaining -= 1
      network.seconds = Math.max(0, remaining)
      if (remaining <= 0) finish(resolve)
    }, 1000)
    const onAbort = () => finish(() => reject(abortError()))
    function finish(done) {
      clearInterval(timer)
      signal?.removeEventListener('abort', onAbort)
      done()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Attend l'évènement `online` (retour du réseau), sans limite de durée. */
export function waitUntilOnline(signal) {
  return new Promise((resolve, reject) => {
    if (navigator.onLine !== false) return resolve()
    if (signal?.aborted) return reject(abortError())
    const finish = (done) => {
      window.removeEventListener('online', onOnline)
      signal?.removeEventListener('abort', onAbort)
      done()
    }
    const onOnline = () => finish(resolve)
    const onAbort = () => finish(() => reject(abortError()))
    window.addEventListener('online', onOnline)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
