import { getRecordWithKey } from '../../../services/file-delivery/common.js';
import { createStorageAdapter } from '../../../services/storage-runtime/adapter-factory.js';
import { createProfileDeleteBackend } from '../../../services/storage-runtime/delete-backend.js';
import { executeStorageDelete } from '../../../services/storage-runtime/delete-operation.js';
import { createCloudflareStorageResolver } from '../../../services/storage-runtime/profile-resolver.js';
import { createStorageReferenceClient } from '../../../services/storage-runtime/reference-client.js';

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function decodedId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return String(value || '');
  }
}

function sanitizeSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(slug) ? slug : '';
}

async function removeMetadata(env, record) {
  const slug = sanitizeSlug(record.metadata.shareSlug);
  if (slug) {
    const mappingKey = `share_slug:${slug}`;
    const mapped = await env.img_url.get(mappingKey);
    if (!mapped || String(mapped) === record.fileId) await env.img_url.delete(mappingKey);
  }
  await env.img_url.delete(record.fileId);
  return Object.freeze({ deleted: true });
}

function dependencies(context) {
  const injected = context.data?.storageLifecycle;
  if (injected) return injected;
  return Object.freeze({
    resolver: createCloudflareStorageResolver(context.env),
    adapterFactory: ({ profile }) => createStorageAdapter({ profile, env: context.env }),
    references: createStorageReferenceClient({ env: context.env }),
    backend: createProfileDeleteBackend(),
    metadata: { remove: ({ record }) => removeMetadata(context.env, record) },
  });
}

async function deleteFile(context) {
  if (!context.env.img_url) return json({ success: false, error: 'KV_BINDING_MISSING' }, 500);
  const requestedId = decodedId(context.params?.id);
  const found = await getRecordWithKey(context.env, requestedId);
  if (!found.record?.metadata) {
    return json({ success: false, error: 'File metadata not found.' }, 404);
  }
  const record = Object.freeze({
    fileId: found.kvKey,
    metadata: Object.freeze({ ...found.record.metadata }),
  });
  try {
    await executeStorageDelete({ record, ...dependencies(context) });
    return json({ success: true, message: 'File deleted.', fileId: requestedId });
  } catch (error) {
    console.error('Delete error:', error);
    return json({ success: false, error: error.code || error.message }, error.status || 500);
  }
}

export function onRequest(context) {
  if (String(context.request.method || 'GET').toUpperCase() !== 'DELETE') {
    return json({ success: false, error: 'Method not allowed.' }, 405, { Allow: 'DELETE' });
  }
  return deleteFile(context);
}

export function onRequestDelete(context) {
  return deleteFile(context);
}
