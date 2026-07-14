import { probeCloudflareStorage } from '../status-probes.js';
import { createStorageAdapter } from '../storage-runtime/adapter-factory.js';

function probeInput(adapter) {
  if (adapter.type === 'r2' && adapter.mode === 'binding') {
    return Object.freeze({ type: 'r2', env: Object.freeze({ R2_BUCKET: adapter.binding }) });
  }
  if (adapter.type === 'r2' && adapter.mode === 's3') {
    return Object.freeze({ type: 's3', env: adapter.environment });
  }
  return Object.freeze({ type: adapter.type, env: adapter.environment });
}

export function testStorageProfile({ env, type, config }) {
  const profile = Object.freeze({
    id: 'storage-profile-test', type, config: Object.freeze({ ...(config || {}) }),
  });
  const adapter = createStorageAdapter({ profile, env });
  return probeCloudflareStorage(probeInput(adapter));
}
