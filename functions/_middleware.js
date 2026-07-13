import fileMetadataPolicy from '../shared/security/file-metadata.cjs';

const { createAccessMetadata, resolveStoredAccessMetadata } = fileMetadataPolicy;
const FILE_UPLOAD_PATHS = Object.freeze(new Set([
  '/upload',
  '/api/upload-from-url',
  '/api/chunked-upload/complete',
  '/api/r2/upload',
  '/api/telegram/webhook',
  '/api/v1/upload',
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

export async function onRequest(context) {
  const pathname = new URL(context.request.url).pathname.replace(/\/+$/, '') || '/';
  if (!FILE_UPLOAD_PATHS.has(pathname)) return context.next();
  context.env = uploadEnvironment(context, pathname);
  return context.next();
}
