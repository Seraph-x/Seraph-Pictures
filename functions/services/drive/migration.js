import { getRecordWithKey } from '../file-delivery/common.js';
import { createStorageAdapter } from '../storage-runtime/adapter-factory.js';
import { createProfileTransferBackend } from '../storage-runtime/transfer-backend.js';
import { executeStorageTransfer } from '../storage-runtime/transfer-operation.js';
import { createCloudflareStorageResolver } from '../storage-runtime/profile-resolver.js';
import { createStorageReferenceClient } from '../storage-runtime/reference-client.js';

function uniqueIds(value) {
  const ids = Array.isArray(value) ? value : [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

function lifecycle(context) {
  const resolver = createCloudflareStorageResolver(context.env);
  return Object.freeze({
    resolver,
    references: createStorageReferenceClient({ env: context.env }),
    adapterFactory: ({ profile }) => createStorageAdapter({ profile, env: context.env }),
    backend: createProfileTransferBackend(context),
  });
}

async function migrateOne(options) {
  const { context, dependencies, fileId, destinationStorageId } = options;
  const found = await getRecordWithKey(context.env, fileId);
  if (!found.record?.metadata) return Object.freeze({ fileId, status: 'not-found' });
  const record = Object.freeze({ fileId: found.kvKey, metadata: found.record.metadata });
  const metadata = {
    replace: async (input) => {
      const next = Object.freeze({
        ...record.metadata,
        ...(input.artifact.metadata || {}),
        storageConfigId: input.storageConfigId,
        storageType: input.storageType,
        storageGeneration: input.storageGeneration,
      });
      await context.env.img_url.put(found.kvKey, found.record.value || '', { metadata: next });
      return Object.freeze({ fileId: found.kvKey, status: 'migrated' });
    },
  };
  return executeStorageTransfer({
    record,
    destination: { storageId: destinationStorageId },
    metadata,
    ...dependencies,
  });
}

export async function migrateFileBatch(context, input) {
  const ids = uniqueIds(input.fileIds || input.ids);
  const destinationStorageId = String(input.destinationStorageId || '').trim();
  if (!ids.length || !destinationStorageId) {
    throw Object.assign(new Error('STORAGE_MIGRATION_INPUT_REQUIRED'), {
      code: 'STORAGE_MIGRATION_INPUT_REQUIRED', status: 400,
    });
  }
  const dependencies = context.data?.storageTransfer || lifecycle(context);
  const results = [];
  for (const id of ids) {
    results.push(await migrateOne({
      context, dependencies, fileId: id, destinationStorageId,
    }));
  }
  return Object.freeze({ requested: ids.length, results: Object.freeze(results) });
}
