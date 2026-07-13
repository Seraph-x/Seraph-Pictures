const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const PAGE_LIMIT = 1000;

function createHeaders(apiToken) {
  return Object.freeze({ Authorization: `Bearer ${apiToken}` });
}

async function requireSuccess(response, operation) {
  if (response.ok) return response;
  throw new Error(`CLOUDFLARE_KV_${operation}_FAILED:${response.status}`);
}

function createBaseUrl({ accountId, namespaceId }) {
  const account = encodeURIComponent(accountId);
  const namespace = encodeURIComponent(namespaceId);
  return `${API_BASE_URL}/accounts/${account}/storage/kv/namespaces/${namespace}`;
}

export function createCloudflareKvSource(options) {
  const { apiToken, fetchImpl = fetch } = options;
  const baseUrl = createBaseUrl(options);
  const headers = createHeaders(apiToken);
  return Object.freeze({
    async listPage(cursor) {
      const url = new URL(`${baseUrl}/keys`);
      url.searchParams.set('limit', String(PAGE_LIMIT));
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await requireSuccess(await fetchImpl(url.toString(), { headers }), 'LIST');
      const payload = await response.json();
      if (!payload.success || !Array.isArray(payload.result)) {
        throw new Error('CLOUDFLARE_KV_LIST_SCHEMA_INVALID');
      }
      return Object.freeze({
        keys: payload.result,
        cursor: payload.result_info?.cursor || null,
      });
    },
    async readValue(name) {
      const key = encodeURIComponent(name);
      const response = await requireSuccess(await fetchImpl(`${baseUrl}/values/${key}`, { headers }), 'READ');
      return Buffer.from(await response.arrayBuffer()).toString('base64');
    },
  });
}
