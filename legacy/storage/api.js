{
  'use strict';

  const STORAGE_V2_ACCEPT = 'application/vnd.seraph.v2+json, application/json;q=0.9';

  function storageOperationError(payload, status) {
    const detail = payload?.error;
    const code = detail?.code || payload?.errorCode || detail?.message || detail || `HTTP_${status}`;
    return Object.assign(new Error(String(code)), { code: String(code), status });
  }

  async function storageParseResponse(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw Object.assign(new Error('STORAGE_RESPONSE_INVALID'), { cause, status: response.status });
    }
    if (!response.ok || payload?.success === false) throw storageOperationError(payload, response.status);
    if (payload?.success !== true) {
      throw Object.assign(new Error('STORAGE_RESPONSE_INVALID'), { status: response.status });
    }
    return payload;
  }

  function storageRequestFactory(options) {
    const fetchImpl = options.fetchImpl || fetch;
    const onUnauthorized = options.onUnauthorized || function redirect() {
      window.location.href = '/login.html';
    };
    return async function request(path, init = {}) {
      const headers = {
        ...(init.headers || {}),
        Accept: STORAGE_V2_ACCEPT,
        'X-Seraph-Client': 'app-v2',
      };
      const response = await fetchImpl(path, { credentials: 'include', ...init, headers });
      if (response.status === 401) onUnauthorized();
      if (response.status === 401) {
        throw storageOperationError({ error: { code: 'AUTH_REQUIRED' } }, 401);
      }
      return storageParseResponse(response);
    };
  }

  function storageJsonInit(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  function storageRequireItem(item) {
    const valid = item && typeof item === 'object'
      && String(item.id || '') && String(item.name || '') && String(item.type || '')
      && item.config && typeof item.config === 'object' && !Array.isArray(item.config);
    if (valid) return item;
    throw new Error('STORAGE_ITEM_RESPONSE_INVALID');
  }

  function storageRequireResult(result) {
    if (result && typeof result === 'object' && typeof result.connected === 'boolean') return result;
    throw new Error('STORAGE_TEST_RESPONSE_INVALID');
  }

  function storageRequireGuest(data, requireSchema = false) {
    const valid = data && typeof data === 'object'
      && data.config && typeof data.config === 'object'
      && data.secretsPresent && typeof data.secretsPresent === 'object';
    if (!valid || (requireSchema && !Array.isArray(data.schema))) {
      throw new Error('STORAGE_GUEST_RESPONSE_INVALID');
    }
    return Object.freeze({
      ...(requireSchema ? { schema: Object.freeze([...data.schema]) } : {}),
      config: Object.freeze({ ...data.config }),
      secretsPresent: Object.freeze({ ...data.secretsPresent }),
      ...(data.preferredStorageType ? { preferredStorageType: data.preferredStorageType } : {}),
    });
  }

  function storageProfileMethods(request) {
    return Object.freeze({
      async listProfiles() {
        const payload = await request('/api/storage/list');
        if (!Array.isArray(payload.items)) throw new Error('STORAGE_LIST_RESPONSE_INVALID');
        return payload.items.map(storageRequireItem);
      },
      async createProfile(body) {
        const payload = await request('/api/storage', storageJsonInit('POST', body));
        return storageRequireItem(payload.item);
      },
      async updateProfile(id, body) {
        const path = `/api/storage/${encodeURIComponent(id)}`;
        const payload = await request(path, storageJsonInit('PUT', body));
        return storageRequireItem(payload.item);
      },
      async deleteProfile(id) {
        return request(`/api/storage/${encodeURIComponent(id)}`, { method: 'DELETE' });
      },
      async setDefault(id) {
        const path = `/api/storage/default/${encodeURIComponent(id)}`;
        return storageRequireItem((await request(path, { method: 'POST' })).item);
      },
      async testProfile(id) {
        const path = `/api/storage/${encodeURIComponent(id)}/test`;
        return storageRequireResult((await request(path, { method: 'POST' })).result);
      },
      async testDraft(type, config) {
        const body = storageJsonInit('POST', { type, config });
        return storageRequireResult((await request('/api/storage/test', body)).result);
      },
    });
  }

  function storageGuestMethods(request) {
    return Object.freeze({
      async loadGuestConfig() {
        const payload = await request('/api/storage-config');
        return storageRequireGuest(payload, true);
      },
      async saveGuestConfig(config) {
        const init = storageJsonInit('POST', { config });
        const payload = await request('/api/storage-config', init);
        return storageRequireGuest(payload);
      },
    });
  }

  function createStorageApi(options = {}) {
    const request = storageRequestFactory(options);
    return Object.freeze({
      ...storageProfileMethods(request),
      ...storageGuestMethods(request),
    });
  }

  const legacyStorageApi = Object.freeze({ createStorageApi });
  if (typeof module === 'object' && module.exports) module.exports = legacyStorageApi;
  globalThis.LegacyStorageApi = legacyStorageApi;
}
