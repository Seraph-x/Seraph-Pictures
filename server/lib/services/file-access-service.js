const { decideFileAccess } = require('../../../shared/security/access-policy.cjs');
const { resolveStoredAccessMetadata } = require('../../../shared/security/file-metadata.cjs');

function decideDockerFileAccess({ file, request, authService, share = null }) {
  if (!file?.metadata) {
    return Object.freeze({ allowed: false, conceal: true, code: 'FILE_ACCESS_DENIED' });
  }
  const metadata = resolveStoredAccessMetadata({
    metadata: file.metadata,
    migrationComplete: true,
  });
  let actor = 'anonymous';
  if (metadata.visibility === 'private') {
    actor = authService.checkAuthentication(request).authenticated ? 'admin' : 'anonymous';
  }
  return decideFileAccess({
    visibility: metadata.visibility,
    actor,
    share,
    accessVersion: metadata.accessVersion,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}

module.exports = { decideDockerFileAccess };
