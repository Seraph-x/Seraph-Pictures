import fileMetadataPolicy from '../../../../shared/security/file-metadata.cjs';
import { readVisibilityMigrationState } from '../../../services/file-access.js';

const PREFIXES = Object.freeze(['', 'img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:']);
const { resolveStoredAccessMetadata, updateVisibility } = fileMetadataPolicy;

async function findRecord(env, fileId) {
  for (const prefix of PREFIXES) {
    const key = prefix && fileId.startsWith(prefix) ? fileId : `${prefix}${fileId}`;
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) return Object.freeze({ key, metadata: record.metadata });
  }
  return null;
}

function jsonError(code, status) {
  return Response.json({ success: false, error: { code } }, { status });
}

export async function onRequestPut(context) {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return jsonError('VALIDATION_ERROR', 400);
  }
  const found = await findRecord(context.env, context.params.id);
  if (!found) return jsonError('FILE_ACCESS_DENIED', 404);
  const migration = await readVisibilityMigrationState(context.env);
  let access;
  try {
    const currentAccess = resolveStoredAccessMetadata({
      metadata: found.metadata,
      migrationComplete: migration.complete,
    });
    access = updateVisibility({
      metadata: { ...found.metadata, ...currentAccess },
      visibility: body.visibility,
      actor: 'admin',
      ownershipTransferred: body.ownershipTransferred === true,
    });
  } catch (error) {
    const status = error?.code === 'FILE_OWNERSHIP_TRANSFER_REQUIRED' ? 409 : 400;
    return jsonError(error?.code || 'FILE_VISIBILITY_INVALID', status);
  }
  const metadata = Object.freeze({ ...found.metadata, ...access });
  await context.env.img_url.put(found.key, '', { metadata });
  return Response.json({ success: true, data: access });
}
