{
  'use strict';

  function settingsError(payload, status) {
    const detail = payload?.error;
    const code = detail?.code || detail?.message || detail || payload?.message || `HTTP_${status}`;
    return Object.assign(new Error(String(code)), { code: String(code), status });
  }

  async function requestJson(options) {
    const init = {
      method: options.method,
      credentials: 'include',
      headers: { Accept: 'application/json' },
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(options.url, init);
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw Object.assign(new Error('SETTINGS_RESPONSE_INVALID'), { cause, status: response.status });
    }
    if (!response.ok || payload?.success === false) throw settingsError(payload, response.status);
    return payload;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function renderTemplate(template, options) {
    return template.replace(/\{\{(t|v):([^}]+)\}\}/g, (_match, type, key) => {
      if (type === 't') return escapeHtml(options.t(key));
      return escapeHtml(options.values[key] ?? '');
    });
  }

  function setStatus(id, state, text) {
    const node = document.getElementById(id);
    if (!node) return;
    node.setAttribute('data-state', state || '');
    node.textContent = text || '';
  }

  globalThis.LegacyAdminSettingsShared = Object.freeze({
    clamp, escapeHtml, renderTemplate, requestJson, setStatus,
  });
}
