const API_BASE_URL = 'https://api.cloudflare.com/client/v4';
const PAGE_LIMIT = 1000;
const WRITE_BATCH_SIZE = 1000;

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
  async function writeBatch(records) {
    const body = records.map((record) => ({
      key: record.name,
      value: record.valueBase64,
      base64: true,
      metadata: record.metadata,
      ...(record.expiration ? { expiration: record.expiration } : {}),
    }));
    const response = await requireSuccess(await fetchImpl(`${baseUrl}/bulk`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), 'WRITE');
    const payload = await response.json();
    if (!payload.success || payload.result?.unsuccessful_keys?.length) {
      throw new Error('CLOUDFLARE_KV_WRITE_SCHEMA_INVALID');
    }
  }
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
    async writeRecords(records) {
      for (let index = 0; index < records.length; index += WRITE_BATCH_SIZE) {
        await writeBatch(records.slice(index, index + WRITE_BATCH_SIZE));
      }
    },
    async writeMarker(marker) {
      await writeBatch([marker]);
    },
  });
}
