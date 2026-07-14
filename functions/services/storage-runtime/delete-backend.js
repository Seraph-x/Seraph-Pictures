import { deleteDiscordMessage } from '../../utils/discord.js';
import { deleteHuggingFaceFile } from '../../utils/huggingface.js';
import { deleteWebDAVFile } from '../../utils/webdav.js';
import { deleteGitHubFile } from '../../utils/github.js';
import { buildTelegramBotApiUrl } from '../../utils/telegram.js';

function cleanupError() {
  return Object.assign(new Error('STORAGE_BACKEND_CLEANUP_UNCONFIRMED'), {
    code: 'STORAGE_BACKEND_CLEANUP_UNCONFIRMED', status: 502,
  });
}

function keyWithoutPrefix(fileId, prefix) {
  return String(fileId || '').replace(new RegExp(`^${prefix}:`), '');
}

async function deleteTelegram(adapter, metadata) {
  if (!metadata.telegramMessageId) throw cleanupError();
  const response = await fetch(buildTelegramBotApiUrl(
    adapter.environment, 'deleteMessage',
  ), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: adapter.environment.TG_Chat_ID,
      message_id: metadata.telegramMessageId,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw cleanupError();
}

async function deleteRemote({ adapter, metadata, fileId, type }) {
  if (type === 'discord') {
    const deleted = await deleteDiscordMessage(
      metadata.discordChannelId, metadata.discordMessageId, adapter.environment,
    );
    if (!deleted) throw cleanupError();
    return;
  }
  if (type === 'huggingface') {
    if (!metadata.hfPath || !await deleteHuggingFaceFile(metadata.hfPath, adapter.environment)) {
      throw cleanupError();
    }
    return;
  }
  if (type === 'webdav') {
    const path = metadata.webdavPath || keyWithoutPrefix(fileId, 'webdav');
    if (!path || !await deleteWebDAVFile(path, adapter.environment)) throw cleanupError();
    return;
  }
  const key = metadata.githubStorageKey || keyWithoutPrefix(fileId, 'github');
  if (!key || !await deleteGitHubFile(key, metadata, adapter.environment)) throw cleanupError();
}

export function createProfileDeleteBackend() {
  return Object.freeze({
    async remove({ adapter, profile, record }) {
      const metadata = record.metadata || {};
      const type = profile.type;
      if (type === 'r2') {
        const key = metadata.r2Key || keyWithoutPrefix(record.fileId, 'r2');
        if (adapter.mode === 'binding') await adapter.binding.delete(key);
        else await adapter.client.deleteObject(key);
        return;
      }
      if (type === 's3') {
        await adapter.client.deleteObject(metadata.s3Key || keyWithoutPrefix(record.fileId, 's3'));
        return;
      }
      if (type === 'telegram') return deleteTelegram(adapter, metadata);
      return deleteRemote({ adapter, metadata, fileId: record.fileId, type });
    },
  });
}
