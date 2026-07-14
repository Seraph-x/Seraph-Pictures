import { deliverFile } from '../file-delivery.js';
import { writeProfileBackend } from '../profile-upload.js';
import { createProfileDeleteBackend } from './delete-backend.js';

function internalContext(context, record) {
  const request = new Request(
    new URL(`/file/${encodeURIComponent(record.fileId)}`, context.request.url),
    { method: 'GET' },
  );
  return Object.freeze({
    ...context,
    request,
    env: Object.freeze({ ...context.env, WhiteList_Mode: 'false' }),
  });
}

async function readSource(options) {
  const { context, record, sourceProfile, sourceAdapter } = options;
  const response = await deliverFile({
    context: internalContext(context, record),
    fileId: record.fileId,
    record: { metadata: { ...record.metadata, ListType: 'None', Label: 'None' } },
    dependencies: {
      resolver: { resolve: async () => sourceProfile },
      adapterFactory: () => sourceAdapter,
    },
  });
  if (!response.ok) {
    throw Object.assign(new Error('STORAGE_TRANSFER_SOURCE_READ_FAILED'), {
      code: 'STORAGE_TRANSFER_SOURCE_READ_FAILED', status: response.status,
    });
  }
  return response;
}

export function createProfileTransferBackend(context) {
  const deletion = createProfileDeleteBackend();
  return Object.freeze({
    async copy(options) {
      const response = await readSource({ context, ...options });
      const fileName = options.record.metadata.fileName || options.record.fileId;
      const file = new File([await response.arrayBuffer()], fileName, {
        type: response.headers.get('Content-Type') || 'application/octet-stream',
      });
      return writeProfileBackend({
        context,
        input: {
          file, fileName, extension: fileName.split('.').pop() || 'bin',
          folderPath: options.record.metadata.folderPath || '',
          storageOperationId: options.record.metadata.storageOperationId,
        },
        adapter: options.destinationAdapter,
        profile: options.destinationProfile,
      });
    },
    remove: (options) => deletion.remove(options),
  });
}
