import policyModule from '../../../shared/storage/profile-policy.cjs';
import { callAuthCoordinator } from '../../utils/auth/coordinator-client.js';
import { createStorageProfileRepository } from '../storage-profiles/repository.js';

const { resolveProfileSelection, StoragePolicyError } = policyModule;

function withGeneration(profile, generation) {
  return Object.freeze({ ...profile, generation });
}

function integrityError() {
  return new StoragePolicyError('STORAGE_PROFILE_INTEGRITY_ERROR');
}

function requestedStorageId(input, snapshot) {
  if (input.storageId) return input.storageId;
  if (!input.legacy) return undefined;
  const storageId = snapshot.legacyTypeProfileIds[input.storageMode];
  if (!storageId) throw integrityError();
  return storageId;
}

export function createStorageProfileResolver({ repository, barrier, preferredType }) {
  return Object.freeze({
    async resolve(input) {
      if (input.forWrite && (await barrier.status()).frozen) {
        throw new StoragePolicyError('STORAGE_PROFILE_MUTATION_FROZEN');
      }
      const snapshot = await repository.runtimeSnapshot();
      const storageId = requestedStorageId(input, snapshot);
      try {
        const profile = resolveProfileSelection({
          items: snapshot.items,
          storageId,
          storageMode: input.storageMode,
          preferredType,
          forWrite: input.forWrite,
        });
        return withGeneration(profile, snapshot.generation);
      } catch (error) {
        if (input.persisted && error?.code === 'STORAGE_PROFILE_NOT_FOUND') throw integrityError();
        throw error;
      }
    },
  });
}

export function createCloudflareStorageResolver(env, dependencies = {}) {
  const repository = dependencies.repository || createStorageProfileRepository(env);
  const barrier = dependencies.barrier || Object.freeze({
    status: () => callAuthCoordinator(env, 'mutationFreezeStatus'),
  });
  return createStorageProfileResolver({
    repository,
    barrier,
    preferredType: dependencies.preferredType || String(env.DEFAULT_STORAGE || 'telegram'),
  });
}
