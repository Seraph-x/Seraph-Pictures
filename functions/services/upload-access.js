import fileMetadataPolicy from '../../shared/security/file-metadata.cjs';

const { createAccessMetadata } = fileMetadataPolicy;
const FIRST_PARTY_SOURCES = Object.freeze(new Set(['image-host', 'drive']));

function accessError() {
  return Object.assign(new Error('FILE_UPLOAD_SOURCE_INVALID'), {
    code: 'FILE_UPLOAD_SOURCE_INVALID', status: 400,
  });
}

export function normalizeFirstPartyUploadAccess(options = {}) {
  if (options.api) {
    return createAccessMetadata({
      uploadSource: 'api', requestedVisibility: options.requestedVisibility || 'public',
    });
  }
  const uploadSource = String(options.uploadSource || 'image-host').trim();
  if (!FIRST_PARTY_SOURCES.has(uploadSource)) throw accessError();
  return createAccessMetadata({ uploadSource });
}
