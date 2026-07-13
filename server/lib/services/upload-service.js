const { buildPublicFileId, normalizeStorageType } = require('../storage/common');
const { normalizeFolderPath } = require('../repos/file-repo');
const { createAccessMetadata } = require('../../../shared/security/file-metadata.cjs');
const { defaultRequestRemote, defaultResolveHostname } = require('../utils/remote-fetch');
const {
  assertPublicHostname,
  assertPublicRedirect,
  parseSafeRemoteUrl,
  RemoteUrlError,
} = require('../utils/remote-url');

const URL_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_URL_UPLOAD_LIMIT = 20 * 1024 * 1024;

function uploadTarget({ storageType, fileName, mimeType, folderPath }) {
  const publicId = buildPublicFileId(storageType, fileName, mimeType);
  const prefix = storageType === 'huggingface' ? 'uploads/' : '';
  const directory = folderPath ? `${folderPath}/` : '';
  return Object.freeze({ publicId, adapterStorageKey: `${prefix}${directory}${publicId}` });
}

function remoteFileName(parsedUrl, contentType) {
  const candidate = decodeURIComponent(parsedUrl.pathname.split('/').pop() || '').trim();
  const extension = String(contentType).split('/')[1]?.split(';')[0] || 'bin';
  if (!candidate) return `url_${Date.now()}.${extension}`;
  return candidate.includes('.') ? candidate : `${candidate}.${extension}`;
}

class UploadService {
  constructor({
    storageRepo,
    fileRepo,
    storageFactory,
    resolveHostname = defaultResolveHostname,
    requestRemote = defaultRequestRemote,
  }) {
    this.storageRepo = storageRepo;
    this.fileRepo = fileRepo;
    this.storageFactory = storageFactory;
    this.resolveHostname = resolveHostname;
    this.requestRemote = requestRemote;
  }

  resolveStorage({ storageId, storageMode }) {
    const storageConfig = this.storageRepo.resolveStorageSelection({ storageId, storageMode });
    if (!storageConfig) {
      throw new Error('No available storage configuration.');
    }
    return storageConfig;
  }

  async uploadFile(options) {
    const {
      fileName, mimeType, fileSize, buffer, storageId, storageMode, folderPath,
      uploadSource = 'image-host', visibility, expiresAt, retentionDays,
    } = options;
    const storageConfig = this.resolveStorage({ storageId, storageMode });
    const adapter = this.storageFactory.createAdapter(storageConfig);
    const storageType = normalizeStorageType(storageConfig.type);
    const normalizedFolderPath = normalizeFolderPath(folderPath);
    const { publicId, adapterStorageKey } = uploadTarget({
      storageType, fileName, mimeType, folderPath: normalizedFolderPath,
    });
    const uploadResult = await adapter.upload({
      storageKey: adapterStorageKey,
      fileName,
      mimeType,
      fileSize,
      buffer,
    });

    const access = createAccessMetadata({ uploadSource, requestedVisibility: visibility });
    const fileRecord = this.fileRepo.create({
      id: publicId,
      storageConfigId: storageConfig.id,
      storageType,
      storageKey: uploadResult.storageKey || adapterStorageKey,
      fileName,
      fileSize,
      mimeType,
      folderPath: normalizedFolderPath,
      ...access,
      expiresAt,
      extra: {
        ...(uploadResult.metadata || {}),
        ...(retentionDays ? { retentionDays } : {}),
      },
    });

    return {
      file: fileRecord,
      src: `/file/${encodeURIComponent(publicId)}`,
      storage: {
        id: storageConfig.id,
        name: storageConfig.name,
        type: storageType,
      },
    };
  }

  async uploadFromUrl(options) {
    const {
      url, storageId, storageMode, folderPath, uploadSource = 'image-host', visibility,
      maxBytes = DEFAULT_URL_UPLOAD_LIMIT,
    } = options;
    const prepared = await this.prepareRemoteFile({ url, maxBytes });
    return this.uploadFile({
      ...prepared, storageId, storageMode, folderPath, uploadSource, visibility,
    });
  }

  async prepareRemoteFile({ url, maxBytes = DEFAULT_URL_UPLOAD_LIMIT }) {
    const parsedUrl = parseSafeRemoteUrl(url);
    await this.assertPublicResolvedHost(parsedUrl);
    const response = await this.requestRemoteFile(parsedUrl, maxBytes);
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await readLimitedBody(response, maxBytes);
    if (arrayBuffer.byteLength === 0) throw new Error('Target URL returned empty body.');
    return Object.freeze({
      fileName: remoteFileName(parsedUrl, contentType),
      mimeType: contentType,
      fileSize: arrayBuffer.byteLength,
      buffer: arrayBuffer,
    });
  }

  async requestRemoteFile(parsedUrl, maxBytes) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await this.requestRemote(parsedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Seraphs-Pictures/2.0',
          Accept: '*/*',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if (isRedirectStatus(response.status)) {
      const redirectUrl = assertPublicRedirect(response, parsedUrl.toString());
      await this.assertPublicResolvedHost(redirectUrl);
      throw new RemoteUrlError(
        `Target URL redirects to ${redirectUrl.toString()}; use the final URL explicitly.`
      );
    }

    if (!response.ok) {
      throw new Error(`Target URL responded with ${response.status}.`);
    }
    const contentLength = parseContentLength(response.headers.get('content-length'));
    assertBodySize(contentLength, maxBytes);
    return response;
  }

  async assertPublicResolvedHost(parsedUrl) {
    const records = await this.resolveHostname(parsedUrl.hostname);
    if (!Array.isArray(records) || records.length === 0) {
      throw new RemoteUrlError('Remote URL host did not resolve.');
    }
    for (const record of records) {
      assertPublicHostname(record.address || record);
    }
  }

  async getFileResponse(fileId, rangeHeader) {
    const file = this.fileRepo.getById(fileId);
    if (!file) return null;

    const storageConfig = this.storageRepo.getById(file.storage_config_id, true);
    if (!storageConfig) {
      throw new Error('Storage config referenced by file not found.');
    }

    const adapter = this.storageFactory.createAdapter(storageConfig);
    const response = await adapter.download({
      storageKey: file.storage_key,
      metadata: file.metadata,
      range: rangeHeader,
    });

    if (!response) return null;

    return {
      file,
      response,
    };
  }

  async deleteFile(fileId) {
    const file = this.fileRepo.getById(fileId);
    if (!file) return { deleted: false, reason: 'not-found' };

    const storageConfig = this.storageRepo.getById(file.storage_config_id, true);
    if (storageConfig) {
      const adapter = this.storageFactory.createAdapter(storageConfig);
      await adapter.delete({ storageKey: file.storage_key, metadata: file.metadata });
    }

    this.fileRepo.delete(fileId);
    return { deleted: true };
  }
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

async function readLimitedBody(response, maxBytes) {
  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength > maxBytes) {
    throw new Error(`Remote file exceeds size limit (${formatMb(maxBytes)}MB).`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    assertBodySize(arrayBuffer.byteLength, maxBytes);
    return arrayBuffer;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalBytes += chunk.byteLength;
    assertBodySize(totalBytes, maxBytes);
    chunks.push(chunk);
  }
  return joinChunks(chunks, totalBytes);
}

function parseContentLength(value) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function assertBodySize(size, maxBytes) {
  if (size > maxBytes) {
    throw new Error(`Remote file exceeds size limit (${formatMb(maxBytes)}MB).`);
  }
}

function formatMb(bytes) {
  return Math.floor(bytes / 1024 / 1024);
}

function joinChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

module.exports = {
  UploadService,
};
