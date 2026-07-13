import {
  buildTelegramBotApiUrl,
  getTelegramCreds,
  getTelegramUploadMethodAndField,
  pickTelegramFileId,
} from '../utils/telegram.js';

const SECONDS_PER_DAY = 86_400;

function extension(fileName) {
  return String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || 'bin';
}

function cleanFolder(value) {
  return String(value || '').split('/').map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..').join('/');
}

async function sendTelegram(file, env) {
  const credentials = getTelegramCreds(env, { guest: true });
  const method = getTelegramUploadMethodAndField(file.type);
  const body = new FormData();
  body.append('chat_id', credentials.chatId);
  body.append(method.field, file);
  const response = await fetch(buildTelegramBotApiUrl(env, method.method, credentials), {
    method: 'POST', body,
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const error = new Error(result.description || 'GUEST_TELEGRAM_UPLOAD_FAILED');
    error.status = 502;
    throw error;
  }
  return result;
}

async function writeMetadata(options) {
  const { env, prepared, fileId, messageId, retentionDays } = options;
  const folderPath = cleanFolder(prepared.folderPath);
  const metadata = Object.freeze({
    TimeStamp: Date.now(),
    ListType: 'None',
    Label: 'None',
    liked: false,
    fileName: prepared.fileName,
    fileSize: prepared.buffer.byteLength,
    storageType: 'telegram',
    telegramFileId: fileId,
    telegramMessageId: messageId,
    signedLink: false,
    guest: true,
    tgBot: 'guest',
    retentionDays,
    ...(folderPath ? { folderPath } : {}),
  });
  await env.img_url.put(`${fileId}.${extension(prepared.fileName)}`, '', {
    metadata,
    expirationTtl: retentionDays * SECONDS_PER_DAY,
  });
}

export async function uploadGuestTelegram(options) {
  const { prepared, env, retentionDays } = options;
  const file = new File([prepared.buffer], prepared.fileName, { type: prepared.mimeType });
  const result = await sendTelegram(file, env);
  const fileId = pickTelegramFileId(result);
  if (!fileId) throw Object.assign(new Error('GUEST_TELEGRAM_FILE_ID_MISSING'), { status: 502 });
  await writeMetadata({
    env, prepared, fileId, retentionDays,
    messageId: result.result?.message_id,
  });
  const directId = `${fileId}.${extension(prepared.fileName)}`;
  return new Response(JSON.stringify([{ src: `/file/${directId}` }]), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
