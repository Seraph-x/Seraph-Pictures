import { callAuthCoordinator } from '../../utils/auth/coordinator-client.js';

const METHODS = Object.freeze({
  reserve: 'storageRefReserve',
  commitStart: 'storageRefCommitStart',
  commitFinish: 'storageRefCommitFinish',
  releaseStart: 'storageRefReleaseStart',
  releaseFinish: 'storageRefReleaseFinish',
  transferStart: 'storageRefTransferStart',
  transferFinish: 'storageRefTransferFinish',
  reconcile: 'storageRefReconcile',
});

export function createStorageReferenceClient({ env, coordinator } = {}) {
  const invoke = coordinator || ((operation, payload) => (
    callAuthCoordinator(env, operation, payload)
  ));
  return Object.freeze(Object.fromEntries(Object.entries(METHODS).map(([method, operation]) => [
    method,
    (payload) => invoke(operation, payload),
  ])));
}
