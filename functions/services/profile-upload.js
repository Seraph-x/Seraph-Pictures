import { uploadToTelegramStorage } from './direct-upload-telegram.js';
import {
  uploadToR2, uploadToS3, uploadToDiscordStorage, uploadToHFStorage,
  uploadToWebDAVStorage, uploadToGitHubStorage,
} from './direct-upload-backends.js';
import { createStorageAdapter } from './storage-runtime/adapter-factory.js';
import { createStorageOperationContext } from './storage-runtime/operation-context.js';
import { createCloudflareStorageResolver } from './storage-runtime/profile-resolver.js';
import { createStorageReferenceClient } from './storage-runtime/reference-client.js';
import { executeStorageWrite } from './storage-runtime/write-operation.js';

const OPERATION_ID_MAX_LENGTH = 128;
const RUNTIME_ENV_FIELDS = Object.freeze([
  'img_url', 'TELEGRAM_LINK_MODE', 'FILE_URL_SECRET', 'TG_FILE_URL_SECRET',
  'MINIMIZE_KV_WRITES', 'TELEGRAM_METADATA_MODE', 'TELEGRAM_SKIP_METADATA',
  'TG_UPLOAD_NOTIFY', 'TELEGRAM_UPLOAD_NOTIFY', 'PUBLIC_BASE_URL',
]);

function operationId(request) {
  const supplied = request.headers.get('Idempotency-Key')
    || request.headers.get('X-Upload-Operation-Id');
  if (!supplied) return crypto.randomUUID();
  const normalized = supplied.trim();
  if (!normalized || normalized.length > OPERATION_ID_MAX_LENGTH) {
    throw Object.assign(new Error('STORAGE_REFERENCE_OPERATION_INVALID'), {
      code: 'STORAGE_REFERENCE_OPERATION_INVALID', status: 400,
    });
  }
  return `upload:${normalized}`;
}

function adapterEnvironment(env, adapter) {
  const runtime = Object.fromEntries(RUNTIME_ENV_FIELDS
    .filter((key) => env[key] !== undefined)
    .map((key) => [key, env[key]]));
  return Object.freeze({
    ...runtime,
    ...adapter.environment,
    R2_ADAPTER_MODE: adapter.mode,
    ...(adapter.mode === 'binding' ? { R2_BUCKET: adapter.binding } : {}),
  });
}

function backendFor(type) {
  const backends = {
    telegram: uploadToTelegramStorage,
    r2: uploadToR2,
    s3: uploadToS3,
    discord: uploadToDiscordStorage,
    huggingface: uploadToHFStorage,
    webdav: uploadToWebDAVStorage,
    github: uploadToGitHubStorage,
  };
  const backend = backends[type];
  if (!backend) throw Object.assign(new Error('STORAGE_BACKEND_UNSUPPORTED'), { status: 400 });
  return backend;
}

export async function writeProfileBackend({ context, input, adapter, profile }) {
  const backend = backendFor(profile.type);
  const metadataProfile = Object.freeze({
    ...profile,
    storageOperationId: input.storageOperationId,
  });
  const artifact = await backend({
    ...input,
    env: adapterEnvironment(context.env, adapter),
    profile: metadataProfile,
    deferMetadata: true,
  });
  if (artifact instanceof Response) {
    throw Object.assign(new Error(await artifact.text()), { status: artifact.status });
  }
  return artifact;
}

export async function executeProfileUpload({ context, selection, upload }) {
  const resolver = createCloudflareStorageResolver(context.env);
  const references = createStorageReferenceClient({ env: context.env });
  const operation = createStorageOperationContext({
    ids: { create: () => operationId(context.request) },
  });
  return executeStorageWrite({
    selection,
    operation,
    payload: Object.freeze({}),
    resolver,
    references,
    adapterFactory: ({ profile }) => createStorageAdapter({ profile, env: context.env }),
    backend: {
      write: ({ adapter, profile }) => writeProfileBackend({
        context,
        input: { ...upload, storageOperationId: operation.operationId },
        adapter,
        profile,
      }),
    },
    metadata: { create: ({ artifact }) => artifact.persist() },
  });
}
