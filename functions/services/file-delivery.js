import { resolveStorageEnv } from '../utils/storage-config.js';
import { handleR2File } from './file-delivery/r2.js';
import { handleRemoteFile } from './file-delivery/remote.js';
import { handleTelegramFile } from './file-delivery/telegram.js';
import { inferStorageType } from './file-delivery/common.js';

const REMOTE_TYPES = new Set(['s3', 'discord', 'huggingface', 'webdav', 'github']);

export async function deliverFile({ context, fileId, record }) {
  const storageType = inferStorageType(fileId, record?.metadata || {});
  const env = await resolveStorageEnv(context.env);
  const deliveryContext = Object.freeze({ ...context, env });
  if (storageType === 'r2') {
    const key = record?.metadata?.r2Key || fileId;
    return handleR2File(deliveryContext, key, record);
  }
  if (REMOTE_TYPES.has(storageType)) {
    return handleRemoteFile({
      context: deliveryContext,
      fileId,
      record,
      storageType,
    });
  }
  return handleTelegramFile(deliveryContext, fileId, record);
}
