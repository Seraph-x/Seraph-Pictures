import {
  buildTelegramBotApiUrl,
  buildTelegramFileUrl,
  getTelegramCreds,
} from '../../utils/telegram.js';
import fileMetadataPolicy from '../../../shared/security/file-metadata.cjs';
import {
  addResponseHeaders,
  blockRedirect,
  errorResponse,
  getMimeType,
  shouldBlock,
  shouldWhitelistDeny,
} from './common.js';

const { createAccessMetadata } = fileMetadataPolicy;

async function getTelegramFilePath(env, fileId, credentials = null) {
  try {
    const response = await fetch(buildTelegramBotApiUrl(env, 'getFile', credentials), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const data = await response.json();
    return data.ok ? data.result.file_path : null;
  } catch (error) {
    console.error('Telegram getFile error:', error);
    return null;
  }
}

async function proxyTelegram({ context, fileId, fileName, mimeType, credentials }) {
  const filePath = await getTelegramFilePath(context.env, fileId, credentials);
  if (!filePath) return errorResponse('Failed to get file path from Telegram', 500);
  const range = context.request.headers.get('Range');
  const headers = range ? { Range: range } : {};
  const upstream = await fetch(buildTelegramFileUrl(context.env, filePath, credentials), {
    method: context.request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  if (!upstream.ok && upstream.status !== 206) {
    return errorResponse('Failed to fetch file from Telegram', upstream.status);
  }
  const responseHeaders = new Headers();
  addResponseHeaders({ headers: responseHeaders, fileName, mimeType, upstream });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function handleTelegramFile(context, fileId, record = null) {
  const metadata = record?.metadata || {};
  const requestUrl = new URL(context.request.url);
  if (shouldBlock(metadata)) return blockRedirect(requestUrl, context.request);
  if (shouldWhitelistDeny(context.env, metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }
  const fileName = metadata.fileName || fileId;
  const credentials = getTelegramCreds(context.env, { guest: metadata.tgBot === 'guest' });
  return proxyTelegram({
    context,
    fileId: String(fileId).split('.')[0],
    fileName,
    mimeType: getMimeType(fileName),
    credentials,
  });
}

export async function ensureSignedTelegramRecord({ env, signed, migrationComplete }) {
  if (!env.img_url) return Object.freeze({ key: '', record: null });
  const extension = signed.fileExtension || 'bin';
  const key = `${signed.fileId}.${extension}`;
  const existing = await env.img_url.getWithMetadata(key);
  if (existing?.metadata) return Object.freeze({ key, record: existing });
  if (migrationComplete) return Object.freeze({ key, record: null });
  const metadata = {
    TimeStamp: signed.timestamp || Date.now(),
    ListType: 'None',
    Label: 'None',
    liked: false,
    fileName: signed.fileName || key,
    fileSize: signed.fileSize || 0,
    storageType: 'telegram',
    telegramFileId: signed.fileId,
    telegramMessageId: signed.messageId || undefined,
    signedLink: true,
    ...createAccessMetadata({ uploadSource: 'legacy' }),
  };
  await env.img_url.put(key, '', {
    metadata,
  });
  return Object.freeze({ key, record: Object.freeze({ value: '', metadata }) });
}

export async function handleSignedTelegramFile(context, signed) {
  const fileName = signed.fileName || `${signed.fileId}.${signed.fileExtension || 'bin'}`;
  return proxyTelegram({
    context,
    fileId: signed.fileId,
    fileName,
    mimeType: signed.mimeType || getMimeType(fileName),
    credentials: null,
  });
}
