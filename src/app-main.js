import { createApp } from 'vue'
import AppPage from './pages/AppPage.vue'
import { registerServiceWorker } from './sw-register.js'
import './style.css'

createApp(AppPage).mount('#app')

registerServiceWorker()

// Demande au navigateur de ne pas évincer le stockage de l'app (modèle IA,
// runtimes) en cas de manque de place. Sans conséquence si refusé.
navigator.storage?.persist?.().catch(() => {})
