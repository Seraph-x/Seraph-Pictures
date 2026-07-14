import { createStorageAdapter } from './storage-runtime/adapter-factory.js';
import { createCloudflareStorageResolver } from './storage-runtime/profile-resolver.js';
import { handleR2File } from './file-delivery/r2.js';
import { handleRemoteFile } from './file-delivery/remote.js';
import { handleTelegramFile } from './file-delivery/telegram.js';
import { inferStorageType } from './file-delivery/common.js';

const REMOTE_TYPES = new Set(['s3', 'discord', 'huggingface', 'webdav', 'github']);

export async function deliverFile({ context, fileId, record, dependencies = {} }) {
  const storageType = inferStorageType(fileId, record?.metadata || {});
  const metadata = record?.metadata || {};
  const resolver = dependencies.resolver || createCloudflareStorageResolver(context.env);
  const profile = await resolver.resolve({
    storageId: metadata.storageConfigId,
    storageMode: storageType,
    forWrite: false,
    persisted: true,
    legacy: !metadata.storageConfigId,
  });
  const adapterFactory = dependencies.adapterFactory || createStorageAdapter;
  const adapter = adapterFactory({ profile, env: context.env });
  const env = Object.freeze({
    ...(context.env.img_url ? { img_url: context.env.img_url } : {}),
    ...(context.env.WhiteList_Mode !== undefined
      ? { WhiteList_Mode: context.env.WhiteList_Mode }
      : {}),
    ...adapter.environment,
    ...(adapter.mode === 'binding' ? { R2_BUCKET: adapter.binding } : {}),
  });
  const deliveryContext = Object.freeze({ ...context, env });
  if (storageType === 'r2') {
    const key = record?.metadata?.r2Key || fileId;
    const handler = dependencies.r2Handler || handleR2File;
    return handler({ context: deliveryContext, r2Key: key, record, adapter });
  }
  if (REMOTE_TYPES.has(storageType)) {
    const handler = dependencies.remoteHandler || handleRemoteFile;
    return handler({
      context: deliveryContext,
      fileId,
      record,
      storageType,
    });
  }
  const handler = dependencies.telegramHandler || handleTelegramFile;
  return handler(deliveryContext, fileId, record);
}
