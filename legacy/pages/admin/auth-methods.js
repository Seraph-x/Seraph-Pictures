{
  'use strict';

  async function checkAdminAuth() {
    const response = await fetch('/api/auth/check', { method: 'GET', credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'AUTH_CHECK_FAILED');
    if (data.authRequired && !data.authenticated) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return false;
    }
    this.showLogoutButton = data.authRequired && data.authenticated;
    return true;
  }

  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: { checkAdminAuth } });
}
