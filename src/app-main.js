import { createApp } from 'vue'
import AppPage from './pages/AppPage.vue'
import { registerServiceWorker } from './sw-register.js'
import './style.css'

createApp(AppPage).mount('#app')

registerServiceWorker()
