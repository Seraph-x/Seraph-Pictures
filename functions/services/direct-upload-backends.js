import { createS3Client } from '../utils/s3client.js';
import { uploadToDiscord } from '../utils/discord.js';
import { uploadToHuggingFace } from '../utils/huggingface.js';
import { normalizeWebDAVPath, uploadToWebDAV } from '../utils/webdav.js';
import { normalizeGitHubStoragePath, uploadToGitHub } from '../utils/github.js';
import {
  appendCommonMetadata, joinStoragePath, randomId, uploadError, uploadResponse,
} from './direct-upload-common.js';

function baseMetadata({ file, fileName, storageType, extra, folderPath, profile }) {
  return appendCommonMetadata({
    TimeStamp: Date.now(), ListType: 'None', Label: 'None', liked: false,
    fileName, fileSize: file.size, storageType,
    ...(profile ? {
      storageConfigId: profile.id,
      storageGeneration: profile.generation,
    } : {}),
    ...extra,
  }, folderPath);
}

async function persist(env, key, metadata) {
  if (env.img_url) await env.img_url.put(key, '', { metadata });
}

async function finalizeUpload(options) {
  const { env, key, metadata, response, deferMetadata } = options;
  if (deferMetadata) {
    return Object.freeze({
      key,
      metadata,
      persist: async () => {
        await persist(env, key, metadata);
        return response;
      },
    });
  }
  await persist(env, key, metadata);
  return response;
}

async function execute(label, operation) {
  try { return await operation(); } catch (error) {
    console.error(`${label} upload error:`, error);
    return uploadError(`${label} upload failed: ${error.message}`);
  }
}

export function uploadToR2(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
  return execute('R2', async () => {
    const objectKey = `${randomId('r2')}.${extension}`;
    const bytes = await file.arrayBuffer();
    if (env.R2_ADAPTER_MODE === 's3') {
      await createS3Client(env).putObject(objectKey, bytes, {
        contentType: file.type || 'application/octet-stream',
        metadata: { 'x-amz-meta-filename': fileName },
      });
    } else {
      await env.R2_BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: file.type },
        customMetadata: { fileName, uploadTime: Date.now().toString() },
      });
    }
    const key = `r2:${objectKey}`;
    const metadata = baseMetadata({
      file, fileName, storageType: 'r2', extra: { r2Key: objectKey }, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}

export function uploadToS3(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
  return execute('S3', async () => {
    const objectKey = `${randomId('s3')}.${extension}`;
    await createS3Client(env).putObject(objectKey, await file.arrayBuffer(), {
      contentType: file.type || 'application/octet-stream',
      metadata: { 'x-amz-meta-filename': fileName, 'x-amz-meta-uploadtime': Date.now().toString() },
    });
    const key = `s3:${objectKey}`;
    const metadata = baseMetadata({
      file, fileName, storageType: 's3', extra: { s3Key: objectKey }, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}

export function uploadToDiscordStorage(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
  return execute('Discord', async () => {
    const result = await uploadToDiscord(await file.arrayBuffer(), fileName, file.type, env);
    if (!result.success) throw new Error(result.error);
    const key = `discord:${randomId('discord')}.${extension}`;
    const extra = {
      discordChannelId: result.channelId, discordMessageId: result.messageId,
      discordAttachmentId: result.attachmentId, discordUploadMode: result.mode,
      discordSourceUrl: result.sourceUrl,
    };
    const metadata = baseMetadata({
      file, fileName, storageType: 'discord', extra, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}

export function uploadToHFStorage(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
  return execute('HuggingFace', async () => {
    const publicId = `${randomId('hf')}.${extension}`;
    const hfPath = joinStoragePath(folderPath, publicId);
    const result = await uploadToHuggingFace(await file.arrayBuffer(), hfPath, fileName, env);
    if (!result.success) throw new Error(result.error);
    const key = `hf:${publicId}`;
    const metadata = baseMetadata({
      file, fileName, storageType: 'huggingface', extra: { hfPath }, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}

export function uploadToWebDAVStorage(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
  return execute('WebDAV', async () => {
    const publicId = `${randomId('wd')}.${extension}`;
    const path = joinStoragePath(folderPath, publicId);
    const result = await uploadToWebDAV(await file.arrayBuffer(), path, file.type || 'application/octet-stream', env);
    const key = `webdav:${publicId}`;
    const extra = { webdavPath: normalizeWebDAVPath(result.path || path), webdavEtag: result.etag || undefined };
    const metadata = baseMetadata({
      file, fileName, storageType: 'webdav', extra, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}

export function uploadToGitHubStorage(options) {
  const { file, fileName, extension, env, folderPath = '', profile, deferMetadata } = options;
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
    const metadata = baseMetadata({
      file, fileName, storageType: 'github', extra, folderPath, profile,
    });
    return finalizeUpload({
      env, key, metadata, deferMetadata, response: uploadResponse(`/file/${key}`),
    });
  });
}
