import { normalizeFolderPath, joinStoragePath, randomId, appendCommonMetadata } from './direct-upload-common.js';

export { normalizeFolderPath, joinStoragePath, randomId, appendCommonMetadata };

export function getFileExtension(fileName) {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionFromMimeType(mimeType) {
  const type = (mimeType || '').split(';')[0].trim().toLowerCase();
  const extensions = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'video/x-msvideo': 'avi', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3',
    'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
    'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'application/pdf': 'pdf',
    'application/zip': 'zip', 'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z', 'text/plain': 'txt', 'application/json': 'json',
  };
  return extensions[type] || 'bin';
}

export function buildFileName(parsedUrl, contentType) {
  let fileName = decodeURIComponent((parsedUrl.pathname.split('/').pop() || '').split('?')[0]);
  if (!fileName) fileName = `url_${Date.now()}.${extensionFromMimeType(contentType)}`;
  if (!fileName.includes('.')) fileName = `${fileName}.${extensionFromMimeType(contentType)}`;
  return fileName;
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
