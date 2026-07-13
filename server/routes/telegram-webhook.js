const {
  getTelegramFileFromMessage,
  createSignedTelegramFileId,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
  buildTelegramDirectLink,
  sendTelegramUploadNotice,
} = require('../lib/utils/telegram-webhook');

function resolveTelegramConfig(container, storageRepo) {
  const storedRecord = storageRepo.findEnabledByType('telegram')[0];
  const stored = storedRecord?.config;
  if (storedRecord?.id && stored?.botToken && stored?.chatId) {
    return {
      storageConfigId: storedRecord.id,
      botToken: stored.botToken,
      chatId: stored.chatId,
      apiBase: stored.apiBase || container.config.telegramApiBase,
    };
  }
  const bootstrap = container.config.bootstrapDefaultStorage?.telegram;
  return bootstrap?.botToken && bootstrap?.chatId
    ? { ...bootstrap, storageConfigId: null }
    : null;
}

function createTelegramEnv(container, config) {
  return {
    ...process.env,
    TG_Bot_Token: config.botToken,
    TG_Chat_ID: config.chatId,
    CUSTOM_BOT_API_URL: config.apiBase,
    PUBLIC_BASE_URL: container.config.publicBaseUrl,
    FILE_URL_SECRET: container.config.configEncryptionKey,
  };
}

function verifyWebhookSecret(context, env) {
  const expected = env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return null;
  const actual = context.req.header('X-Telegram-Bot-Api-Secret-Token') || '';
  return actual === expected
    ? null
    : context.json({ ok: false, error: 'Invalid webhook secret.' }, 401);
}

function normalizeReply(result, chatId) {
  if (!chatId) return Object.freeze({
    attempted: false, ok: false, skipped: true, reason: 'missing-chat-id',
  });
  if (!result) return Object.freeze({
    attempted: true, ok: false, skipped: false, reason: 'empty-result',
  });
  return Object.freeze({
    attempted: !result.skipped,
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    reason: result.reason || result.error || result.data?.description || '',
    status: result.data?.error_code || undefined,
  });
}

function persistMetadata({ fileRepo, media, config, useSigned }) {
  if (!config.storageConfigId) throw new Error('TELEGRAM_STORAGE_CONFIG_UNAVAILABLE');
  const publicId = `${media.fileId}.${media.fileExtension}`;
  if (fileRepo.getById(publicId)) return;
  fileRepo.create({
    id: publicId,
    storageConfigId: config.storageConfigId,
    storageType: 'telegram',
    storageKey: media.fileId,
    fileName: media.fileName,
    fileSize: media.fileSize,
    mimeType: media.mimeType,
    folderPath: '',
    extra: {
      fromWebhook: true,
      signedLink: useSigned,
      telegramFileId: media.fileId,
      telegramMessageId: media.messageId || undefined,
    },
  });
}

async function sendReply({ message, media, directLink, env }) {
  const chatId = message?.chat?.id;
  if (!chatId) return normalizeReply(null, chatId);
  const result = await sendTelegramUploadNotice({
    chatId,
    replyToMessageId: message.message_id,
    directLink,
    fileId: media.fileId,
    messageId: media.messageId || message.message_id,
    fileName: media.fileName,
    fileSize: media.fileSize,
  }, env);
  if (!result?.ok && !result?.skipped) {
    console.warn('[telegram-webhook] reply failed:',
      result?.data?.description || result?.error || 'unknown error');
  }
  return normalizeReply(result, chatId);
}

function directFileId(media, env, useSigned) {
  if (!useSigned) return `${media.fileId}.${media.fileExtension}`;
  return createSignedTelegramFileId({
    fileId: media.fileId,
    fileExtension: media.fileExtension,
    fileName: media.fileName,
    mimeType: media.mimeType,
    fileSize: media.fileSize,
    messageId: media.messageId,
  }, env);
}

async function readMessage(context) {
  try {
    const update = await context.req.json();
    return Object.freeze({ message: update?.message || update?.channel_post, error: null });
  } catch {
    return Object.freeze({ message: null, error: 'Invalid JSON body.' });
  }
}

async function handleTelegramWebhook(context, container, helpers) {
  const services = helpers.getServices(context);
  const config = resolveTelegramConfig(container, services.storageRepo);
  if (!config?.botToken) {
    return context.json({ ok: false, error: 'No Telegram bot token configured.' }, 500);
  }
  const env = createTelegramEnv(container, config);
  const unauthorized = verifyWebhookSecret(context, env);
  if (unauthorized) return unauthorized;
  const parsed = await readMessage(context);
  if (parsed.error) return context.json({ ok: false, error: parsed.error }, 400);
  if (!parsed.message) return context.json({ ok: true, ignored: 'no-message' });
  const media = getTelegramFileFromMessage(parsed.message);
  if (!media) return context.json({ ok: true, ignored: 'message-without-file' });
  const useSigned = shouldUseSignedTelegramLinks(env);
  if (useSigned || shouldWriteTelegramMetadata(env)) {
    try {
      persistMetadata({ fileRepo: services.fileRepo, media, config, useSigned });
    } catch (error) {
      console.error('[telegram-webhook] metadata store error:', error.message);
      return context.json({ ok: false, error: 'Telegram metadata persistence failed.' }, 500);
    }
  }
  const directId = directFileId(media, env, useSigned);
  const directLink = buildTelegramDirectLink(env, directId, new URL(context.req.url).origin);
  const reply = await sendReply({ message: parsed.message, media, directLink, env });
  return context.json({
    ok: true, directLink, storageType: 'telegram', mode: useSigned ? 'signed' : 'direct',
    update: {
      chatId: parsed.message?.chat?.id,
      messageId: parsed.message.message_id,
      mediaKind: media.kind,
    },
    reply,
  });
}

module.exports = {
  handleTelegramWebhook,
  persistMetadata,
  resolveTelegramConfig,
};
