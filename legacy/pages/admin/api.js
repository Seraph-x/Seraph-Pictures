{
  'use strict';

  function adminError(payload, status) {
    const detail = payload?.error;
    const code = detail?.code || payload?.errorCode || detail?.message || detail || `HTTP_${status}`;
    return Object.assign(new Error(String(code)), { code: String(code), status });
  }

  async function parseAdminResponse(response) {
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw Object.assign(new Error('ADMIN_RESPONSE_INVALID'), { cause, status: response.status });
    }
    if (!response.ok || payload?.success === false) throw adminError(payload, response.status);
    if (payload?.success !== true) {
      throw Object.assign(new Error('ADMIN_RESPONSE_INVALID'), { status: response.status });
    }
    return payload;
  }

  function createAdminApi(options = {}) {
    const fetchImpl = options.fetchImpl || fetch;
    const storageApi = options.storageApi || LegacyStorageApi.createStorageApi({ fetchImpl });
    async function request(path, init = {}) {
      const response = await fetchImpl(path, { credentials: 'include', ...init });
      return parseAdminResponse(response);
    }
    return Object.freeze({
      listProfiles: storageApi.listProfiles,
      async migrateFiles(ids, destinationStorageId) {
        return request('/api/drive/files/migrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...ids], destinationStorageId }),
        });
      },
    });
  }

  const legacyAdminApi = Object.freeze({ createAdminApi, parseAdminResponse });
  if (typeof module === 'object' && module.exports) module.exports = legacyAdminApi;
  globalThis.LegacyAdminApi = legacyAdminApi;
}
