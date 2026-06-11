<template>
  <div class="claude-login-page">
    <section class="claude-login-shell" aria-labelledby="login-title">
      <header class="claude-login-heading">
        <span class="claude-mark" aria-hidden="true"></span>
        <h1 id="login-title" class="claude-login-title">Welcome, Seraph</h1>
      </header>

      <form class="claude-login-box" @submit.prevent="submit">
        <div class="claude-login-fields">
          <label class="claude-login-field">
            <span>Username</span>
            <input v-model.trim="username" autocomplete="username" required />
          </label>
          <label class="claude-login-field">
            <span>Password</span>
            <input v-model="password" type="password" autocomplete="current-password" required />
          </label>
        </div>

        <div class="claude-login-actions">
          <p class="muted">Seraph's Pictures private workspace</p>
          <button class="btn" :disabled="submitting">
            {{ submitting ? 'Signing in...' : 'Sign In' }}
          </button>
        </div>
      </form>

      <p v-if="error" class="error">{{ error }}</p>
      <p class="muted claude-login-note">
        Need the old page?
        <a href="/login.html" target="_blank" rel="noopener">Open legacy login</a>
      </p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref('');

onMounted(async () => {
  if (!authStore.initialized) {
    await authStore.refresh();
  }

  if (!authStore.authRequired || authStore.authenticated) {
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.replace(target);
  }
});

async function submit() {
  submitting.value = true;
  error.value = '';
  try {
    await authStore.login(username.value, password.value);
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    router.push(target);
  } catch (err) {
    error.value = err.message || 'Login failed';
  } finally {
    submitting.value = false;
  }
}
</script>
