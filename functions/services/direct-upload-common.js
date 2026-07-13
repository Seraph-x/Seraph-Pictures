export function normalizeFileExtension(fileName) {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase()?.replace(/[^a-z0-9]/g, '');
  return ext || 'bin';
}

export function normalizeFolderPath(value) {
  const output = [];
  for (const part of String(value || '').replace(/\\/g, '/').trim().split('/')) {
    const piece = part.trim();
    if (!piece || piece === '.') continue;
    if (piece === '..') { output.pop(); continue; }
    output.push(piece);
  }
  return output.join('/');
}

export function joinStoragePath(folderPath, fileName) {
  const base = normalizeFolderPath(folderPath);
  return base ? `${base}/${fileName}` : fileName;
}

export function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function appendCommonMetadata(metadata, folderPath) {
  return folderPath ? { ...metadata, folderPath } : metadata;
}

export function uploadResponse(src) {
  return new Response(JSON.stringify([{ src }]), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export function uploadError(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
