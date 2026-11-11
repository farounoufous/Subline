import { createApp } from 'vue'
import App from './App.vue'
import { registerServiceWorker } from './sw-register.js'
import './style.css'

createApp(App).mount('#app')

registerServiceWorker()
