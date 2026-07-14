export const OPERATION_METHODS = Object.freeze({
  bootstrapLogin: 'bootstrapLogin',
  migrateLegacyLogin: 'migrateLegacyLogin',
  completeLegacyCredentialCleanup: 'completeLegacyCredentialCleanup',
  verifyCredentials: 'verifyCredentials',
  verifySession: 'verifySession',
  issueSession: 'issueSession',
  readProfile: 'readProfile',
  getProfile: 'getProfile',
  changeCredentials: 'changeCredentials',
  logout: 'logout',
  status: 'status',
  listPasskeys: 'listPasskeys',
  putPasskeyChallenge: 'putPasskeyChallenge',
  takePasskeyChallenge: 'takePasskeyChallenge',
  savePasskey: 'savePasskey',
  updatePasskeyCounter: 'updatePasskeyCounter',
  renamePasskey: 'renamePasskey',
  deletePasskey: 'deletePasskey',
  passkeyMigrationStatus: 'passkeyMigrationStatus',
  migrateLegacyPasskeys: 'migrateLegacyPasskeys',
  completeLegacyPasskeyCleanup: 'completeLegacyPasskeyCleanup',
  configReadAuthority: 'configReadAuthority',
  configBegin: 'configBegin',
  configCommit: 'configCommit',
  configAbort: 'configAbort',
  configAbortStale: 'configAbortStale',
  storageProfileCatalogReadAuthority: 'storageProfileCatalogReadAuthority',
  storageProfileCatalogActivate: 'storageProfileCatalogActivate',
  storageProfileLedgerStage: 'storageProfileLedgerStage',
  storageRefReserve: 'storageRefReserve',
  storageRefCommitStart: 'storageRefCommitStart',
  storageRefCommitFinish: 'storageRefCommitFinish',
  storageRefReleaseStart: 'storageRefReleaseStart',
  storageRefReleaseFinish: 'storageRefReleaseFinish',
  storageRefTransferStart: 'storageRefTransferStart',
  storageRefTransferFinish: 'storageRefTransferFinish',
  storageRefReconcile: 'storageRefReconcile',
  shareCreate: 'shareCreate',
  shareRead: 'shareRead',
  shareConsume: 'shareConsume',
  shareRevoke: 'shareRevoke',
  shareLeaseRead: 'shareLeaseRead',
  shareConsumeStartLease: 'shareConsumeStartLease',
  shareLeaseAdvance: 'shareLeaseAdvance',
  quotaReserve: 'quotaReserve',
  quotaComplete: 'quotaComplete',
  quotaCancel: 'quotaCancel',
  quotaReleaseExpired: 'quotaReleaseExpired',
  mutationEnter: 'mutationEnter',
  mutationExit: 'mutationExit',
  mutationFreezeBegin: 'mutationFreezeBegin',
  mutationFreezeEnd: 'mutationFreezeEnd',
  mutationFreezeAbort: 'mutationFreezeAbort',
  mutationFreezeStatus: 'mutationFreezeStatus',
  mutationReleaseExpired: 'mutationReleaseExpired',
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readPayload(request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    return payload;
  } catch {
    return null;
  }
}

function readOperation(request) {
  return new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
}

export async function routeAuthOperation({ request, service }) {
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405);
  const method = OPERATION_METHODS[readOperation(request)];
  if (!method) return jsonResponse({ error: { code: 'COORDINATOR_OPERATION_UNKNOWN' } }, 404);
  const payload = await readPayload(request);
  if (!payload) return jsonResponse({ error: { code: 'COORDINATOR_PAYLOAD_INVALID' } }, 400);
  return jsonResponse({ data: await service[method](payload) });
}
