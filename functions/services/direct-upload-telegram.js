import {
  buildTelegramDirectLink, buildTelegramBotApiUrl, createSignedTelegramFileId,
  getTelegramCreds, getTelegramUploadMethodAndField, pickTelegramFileId,
  sendTelegramUploadNotice, shouldUseSignedTelegramLinks, shouldWriteTelegramMetadata,
} from '../utils/telegram.js';
import { appendCommonMetadata, uploadResponse } from './direct-upload-common.js';

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
const SECONDS_PER_DAY = 86_400;

async function requestTelegram({ formData, apiEndpoint, env, creds }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(buildTelegramBotApiUrl(env, apiEndpoint, creds), {
      method: 'POST', body: formData, signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function documentRetry(formData, apiEndpoint) {
  if (!['sendPhoto', 'sendAudio'].includes(apiEndpoint)) return null;
  const next = new FormData();
  next.append('chat_id', formData.get('chat_id'));
  next.append('document', formData.get(apiEndpoint === 'sendPhoto' ? 'photo' : 'audio'));
  return next;
}

async function sendToTelegram(options) {
  const { formData, apiEndpoint, env, retryCount, creds } = options;
  try {
    const response = await requestTelegram(options);
    const data = await response.json();
    if (response.ok) return { success: true, data, messageId: data?.result?.message_id };
    if (response.status === 413) return { success: false, error: 'Telegram file size limit exceeded.' };
    if (retryCount >= MAX_RETRIES) return { success: false, error: data.description || 'Upload to Telegram failed' };
    const alternate = documentRetry(formData, apiEndpoint);
    if (alternate) return sendToTelegram({ ...options, formData: alternate, apiEndpoint: 'sendDocument', retryCount: retryCount + 1 });
    const retryAfter = response.status === 429 ? data.parameters?.retry_after || 5 : 1;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return sendToTelegram({ ...options, retryCount: retryCount + 1 });
  } catch (error) {
    if (retryCount >= MAX_RETRIES) {
      return { success: false, error: error.name === 'AbortError' ? 'Telegram request timed out.' : 'Network error while uploading to Telegram.' };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1)));
    return sendToTelegram({ ...options, retryCount: retryCount + 1 });
  }
}

function metadataArtifact(options) {
  const {
    env, fileId, extension, file, fileName, messageId, useSigned,
    folderPath, guest, profile, access,
  } = options;
  const metadata = appendCommonMetadata({
    TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
    fileName, fileSize: file.size, storageType: 'telegram', telegramFileId: fileId,
    telegramMessageId: messageId || undefined, signedLink: useSigned,
    ...(profile ? {
      storageConfigId: profile.id,
      storageGeneration: profile.generation,
      storageOperationId: profile.storageOperationId,
    } : {}),
    ...(access || {}),
    ...(guest ? { guest: true, guestIp: guest.guestIp, tgBot: 'guest' } : {}),
  }, folderPath);
  const putOptions = { metadata };
  const days = guest ? Math.max(0, Math.round(Number(guest.retentionDays)) || 0) : 0;
  if (days) putOptions.expirationTtl = days * SECONDS_PER_DAY;
  return Object.freeze({ key: `${fileId}.${extension}`, metadata, putOptions });
}

async function persistMetadata(env, artifact, guest) {
  if (!env.img_url || (!guest && !shouldWriteTelegramMetadata(env))) return;
  await env.img_url.put(artifact.key, '', artifact.putOptions);
}

async function sendNotice(options) {
  const { env, directId, origin, messageId, fileId, fileName, fileSize } = options;
  const result = await sendTelegramUploadNotice({
    chatId: env.TG_Chat_ID, replyToMessageId: messageId || undefined,
    directLink: buildTelegramDirectLink(env, directId, origin), fileId, messageId,
    fileName, fileSize,
  }, env);
  if (!result?.ok && !result?.skipped) {
    console.warn('Telegram upload notice failed:', result?.data?.description || result?.error || 'unknown error');
  }
}

export async function uploadToTelegramStorage(options) {
  const {
    file, fileName, extension, env, origin = '', folderPath = '', guest = null,
    profile, deferMetadata = false,
  } = options;
  const creds = getTelegramCreds(env, { guest: Boolean(guest) });
  const form = new FormData();
  form.append('chat_id', creds.chatId);
  const { method, field } = getTelegramUploadMethodAndField(file.type);
  form.append(field, file);
  const result = await sendToTelegram({ formData: form, apiEndpoint: method, env, retryCount: 0, creds });
  if (!result.success) throw new Error(result.error);
  const fileId = pickTelegramFileId(result.data);
  if (!fileId) throw new Error('Failed to get file ID');
  const messageId = result.messageId || result.data?.result?.message_id;
  const useSigned = !guest && shouldUseSignedTelegramLinks(env);
  const directId = useSigned
    ? await createSignedTelegramFileId({ fileId, fileExtension: extension, fileName, mimeType: file.type, fileSize: file.size, messageId }, env)
    : `${fileId}.${extension}`;
  if (!guest) await sendNotice({ env, directId, origin, messageId, fileId, fileName, fileSize: file.size });
  const response = uploadResponse(`/file/${directId}`);
  const artifact = metadataArtifact({
    env, fileId, extension, file, fileName, messageId, useSigned,
    folderPath, guest, profile, access: options.access,
  });
  const persist = () => persistMetadata(env, artifact, guest);
  if (deferMetadata) {
    return Object.freeze({
      key: artifact.key,
      metadata: artifact.metadata,
      persist: async () => { await persist(); return response; },
    });
  }
  await persist();
  return response;
}
