const VISIBILITIES = Object.freeze(new Set(['public', 'private']));
const UPLOAD_SOURCES = Object.freeze(new Set(['guest', 'image-host', 'drive', 'api', 'legacy']));
const DEFAULT_VISIBILITY = Object.freeze({
  guest: 'public',
  'image-host': 'public',
  drive: 'private',
  api: 'public',
  legacy: 'public',
});

function metadataError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateSource(uploadSource) {
  if (!UPLOAD_SOURCES.has(uploadSource)) throw metadataError('FILE_UPLOAD_SOURCE_INVALID');
}

function validateVisibility(visibility) {
  if (!VISIBILITIES.has(visibility)) throw metadataError('FILE_VISIBILITY_INVALID');
}

function createAccessMetadata({ uploadSource, requestedVisibility } = {}) {
  validateSource(uploadSource);
  const defaultVisibility = DEFAULT_VISIBILITY[uploadSource];
  const visibility = requestedVisibility || defaultVisibility;
  validateVisibility(visibility);
  if (uploadSource !== 'api' && visibility !== defaultVisibility) {
    throw metadataError('FILE_VISIBILITY_INVALID');
  }
  return Object.freeze({ visibility, uploadSource, accessVersion: 1 });
}

function resolveStoredAccessMetadata({ metadata, migrationComplete }) {
  const visibility = metadata?.visibility;
  const uploadSource = metadata?.uploadSource;
  const accessVersion = Number(metadata?.accessVersion);
  if (!visibility && !migrationComplete) {
    return createAccessMetadata({ uploadSource: 'legacy' });
  }
  validateVisibility(visibility);
  validateSource(uploadSource);
  if (!Number.isInteger(accessVersion) || accessVersion < 1) {
    throw metadataError('FILE_VISIBILITY_INVALID');
  }
  const owner = metadata?.owner === 'admin' ? { owner: 'admin' } : {};
  return Object.freeze({ visibility, uploadSource, accessVersion, ...owner });
}

function updateVisibility(options) {
  const {
    metadata,
    visibility,
    actor,
    ownershipTransferred = false,
  } = options;
  if (actor !== 'admin') throw metadataError('FILE_ACCESS_DENIED');
  validateVisibility(visibility);
  const current = resolveStoredAccessMetadata({ metadata, migrationComplete: true });
  const guestPrivate = current.uploadSource === 'guest' && visibility === 'private';
  if (guestPrivate && current.owner !== 'admin' && !ownershipTransferred) {
    throw metadataError('FILE_OWNERSHIP_TRANSFER_REQUIRED');
  }
  const owner = guestPrivate || current.owner === 'admin' ? { owner: 'admin' } : {};
  return Object.freeze({
    visibility,
    uploadSource: current.uploadSource,
    accessVersion: current.accessVersion + 1,
    ...owner,
  });
}

module.exports = {
  createAccessMetadata,
  resolveStoredAccessMetadata,
  updateVisibility,
};
