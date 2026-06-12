import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import './styles.css';

// Only load dark theme if localStorage theme is 'dark'
const themeMode = localStorage.getItem('themeMode');
if (themeMode === 'dark') {
  import('./claude-theme.css');
}

import('./claude-layout.css');

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
