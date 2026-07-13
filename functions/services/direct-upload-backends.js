import { createS3Client } from '../utils/s3client.js';
import { uploadToDiscord } from '../utils/discord.js';
import { uploadToHuggingFace } from '../utils/huggingface.js';
import { normalizeWebDAVPath, uploadToWebDAV } from '../utils/webdav.js';
import { normalizeGitHubStoragePath, uploadToGitHub } from '../utils/github.js';
import {
  appendCommonMetadata, joinStoragePath, randomId, uploadError, uploadResponse,
} from './direct-upload-common.js';

function baseMetadata({ file, fileName, storageType, extra, folderPath }) {
  return appendCommonMetadata({
    TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
    fileName, fileSize: file.size, storageType, ...extra,
  }, folderPath);
}

async function persist(env, key, metadata) {
  if (env.img_url) await env.img_url.put(key, '', { metadata });
}

async function execute(label, operation) {
  try { return await operation(); } catch (error) {
    console.error(`${label} upload error:`, error);
    return uploadError(`${label} upload failed: ${error.message}`);
  }
}

export function uploadToR2({ file, fileName, extension, env, folderPath = '' }) {
  return execute('R2', async () => {
    const objectKey = `${randomId('r2')}.${extension}`;
    await env.R2_BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { fileName, uploadTime: Date.now().toString() },
    });
    await persist(env, `r2:${objectKey}`, baseMetadata({
      file, fileName, storageType: 'r2', extra: { r2Key: objectKey }, folderPath,
    }));
    return uploadResponse(`/file/r2:${objectKey}`);
  });
}

export function uploadToS3({ file, fileName, extension, env, folderPath = '' }) {
  return execute('S3', async () => {
    const objectKey = `${randomId('s3')}.${extension}`;
    await createS3Client(env).putObject(objectKey, await file.arrayBuffer(), {
      contentType: file.type || 'application/octet-stream',
      metadata: { 'x-amz-meta-filename': fileName, 'x-amz-meta-uploadtime': Date.now().toString() },
    });
    await persist(env, `s3:${objectKey}`, baseMetadata({
      file, fileName, storageType: 's3', extra: { s3Key: objectKey }, folderPath,
    }));
    return uploadResponse(`/file/s3:${objectKey}`);
  });
}

export function uploadToDiscordStorage({ file, fileName, extension, env, folderPath = '' }) {
  return execute('Discord', async () => {
    const result = await uploadToDiscord(await file.arrayBuffer(), fileName, file.type, env);
    if (!result.success) throw new Error(result.error);
    const key = `discord:${randomId('discord')}.${extension}`;
    const extra = {
      discordChannelId: result.channelId, discordMessageId: result.messageId,
      discordAttachmentId: result.attachmentId, discordUploadMode: result.mode,
      discordSourceUrl: result.sourceUrl,
    };
    await persist(env, key, baseMetadata({ file, fileName, storageType: 'discord', extra, folderPath }));
    return uploadResponse(`/file/${key}`);
  });
}

export function uploadToHFStorage({ file, fileName, extension, env, folderPath = '' }) {
  return execute('HuggingFace', async () => {
    const publicId = `${randomId('hf')}.${extension}`;
    const hfPath = joinStoragePath(folderPath, publicId);
    const result = await uploadToHuggingFace(await file.arrayBuffer(), hfPath, fileName, env);
    if (!result.success) throw new Error(result.error);
    const key = `hf:${publicId}`;
    await persist(env, key, baseMetadata({ file, fileName, storageType: 'huggingface', extra: { hfPath }, folderPath }));
    return uploadResponse(`/file/${key}`);
  });
}

export function uploadToWebDAVStorage({ file, fileName, extension, env, folderPath = '' }) {
  return execute('WebDAV', async () => {
    const publicId = `${randomId('wd')}.${extension}`;
    const path = joinStoragePath(folderPath, publicId);
    const result = await uploadToWebDAV(await file.arrayBuffer(), path, file.type || 'application/octet-stream', env);
    const key = `webdav:${publicId}`;
    const extra = { webdavPath: normalizeWebDAVPath(result.path || path), webdavEtag: result.etag || undefined };
    await persist(env, key, baseMetadata({ file, fileName, storageType: 'webdav', extra, folderPath }));
    return uploadResponse(`/file/${key}`);
  });
}

export function uploadToGitHubStorage({ file, fileName, extension, env, folderPath = '' }) {
  return execute('GitHub', async () => {
    const publicId = `${randomId('github')}.${extension}`;
    const storageKey = normalizeGitHubStoragePath(joinStoragePath(folderPath, publicId));
    const result = await uploadToGitHub(
      await file.arrayBuffer(), storageKey, fileName, file.type || 'application/octet-stream', env,
    );
    const key = `github:${publicId}`;
    const extra = {
      githubStorageKey: normalizeGitHubStoragePath(result.storagePath || storageKey),
      ...(result.metadata || {}),
    };
    await persist(env, key, baseMetadata({ file, fileName, storageType: 'github', extra, folderPath }));
    return uploadResponse(`/file/${key}`);
  });
}
