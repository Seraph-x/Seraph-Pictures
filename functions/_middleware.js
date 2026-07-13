import fileMetadataPolicy from '../shared/security/file-metadata.cjs';
import { checkAuthentication, isAuthRequired } from './utils/auth.js';
import { handleGuestUpload } from './services/guest-upload-handler.js';

const { createAccessMetadata, resolveStoredAccessMetadata } = fileMetadataPolicy;
const FILE_UPLOAD_PATHS = Object.freeze(new Set([
  '/upload',
  '/api/upload-from-url',
  '/api/chunked-upload/complete',
  '/api/r2/upload',
  '/api/telegram/webhook',
  '/api/v1/upload',
]));
const GUEST_UPLOAD_PATHS = Object.freeze(new Set(['/upload', '/api/upload-from-url']));
const CHUNK_UPLOAD_PATHS = Object.freeze(new Set([
  '/api/chunked-upload/init',
  '/api/chunked-upload/chunk',
  '/api/chunked-upload/complete',
]));

function isFileMetadata(metadata) {
  return Boolean(metadata)
    && typeof metadata === 'object'
    && typeof metadata.fileName === 'string'
    && metadata.TimeStamp !== undefined;
}

function accessFor(context, metadata, pathname) {
  const accessFields = [metadata.visibility, metadata.uploadSource, metadata.accessVersion];
  if (accessFields.some((value) => value !== undefined)) {
    return resolveStoredAccessMetadata({ metadata, migrationComplete: true });
  }
  const uploadSource = pathname === '/api/v1/upload'
    ? 'api'
    : (metadata.guest ? 'guest' : 'image-host');
  const requestedVisibility = uploadSource === 'api'
    ? (context.data?.fileVisibility || 'public')
    : undefined;
  return createAccessMetadata({ uploadSource, requestedVisibility });
}

function wrapKvBinding(binding, context, pathname) {
  return new Proxy(binding, {
    get(target, property) {
      if (property !== 'put') {
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async (key, value, options = {}) => {
        if (!isFileMetadata(options.metadata)) return target.put(key, value, options);
        const metadata = Object.freeze({
          ...options.metadata,
          ...accessFor(context, options.metadata, pathname),
        });
        return target.put(key, value, { ...options, metadata });
      };
    },
  });
}

function uploadEnvironment(context, pathname) {
  const env = context.env;
  if (!env?.img_url?.put) return env;
  const apiOverrides = pathname === '/api/v1/upload'
    ? {
        MINIMIZE_KV_WRITES: 'false',
        TELEGRAM_LINK_MODE: 'metadata',
        TELEGRAM_METADATA_MODE: 'always',
      }
    : {};
  return Object.freeze({
    ...env,
    ...apiOverrides,
    img_url: wrapKvBinding(env.img_url, context, pathname),
  });
}

async function isGuestRequest(context, pathname) {
  const protectedPath = GUEST_UPLOAD_PATHS.has(pathname) || CHUNK_UPLOAD_PATHS.has(pathname);
  if (context.request.method !== 'POST' || !protectedPath) return false;
  if (context.data?.apiToken || !isAuthRequired(context.env)) return false;
  const authentication = await checkAuthentication(context);
  return !authentication.authenticated;
}

function chunkGuestRejected() {
  return new Response(JSON.stringify({
    error: '访客不支持分片上传，请使用普通上传',
    code: 'GUEST_CHUNK_UPLOAD_REJECTED',
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname.replace(/\/+$/, '') || '/';
  const isFileUpload = FILE_UPLOAD_PATHS.has(pathname);
  const isChunkUpload = CHUNK_UPLOAD_PATHS.has(pathname);
  if (!isFileUpload && !isChunkUpload) return context.next();
  if (isFileUpload) context.env = uploadEnvironment(context, pathname);
  if (await isGuestRequest(context, pathname)) {
    if (GUEST_UPLOAD_PATHS.has(pathname)) return handleGuestUpload(context, pathname);
    return chunkGuestRejected();
  }
  return context.next();
}
