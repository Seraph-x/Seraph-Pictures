import { createS3Client } from '../../utils/s3client.js';
import { getDiscordFileUrl } from '../../utils/discord.js';
import { getHuggingFaceFile } from '../../utils/huggingface.js';
import { getWebDAVFile } from '../../utils/webdav.js';
import { getGitHubFile } from '../../utils/github.js';
import {
  addResponseHeaders,
  blockRedirect,
  errorResponse,
  getMimeType,
  shouldBlock,
  shouldWhitelistDeny,
} from './common.js';

function denyListed(context, metadata) {
  const url = new URL(context.request.url);
  if (shouldBlock(metadata)) return blockRedirect(url, context.request);
  if (shouldWhitelistDeny(context.env, metadata)) {
    return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
  }
  return null;
}

function responseFromUpstream({ upstream, fileName }) {
  const headers = new Headers();
  addResponseHeaders({
    headers,
    fileName,
    mimeType: getMimeType(fileName),
    upstream,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

async function loadS3(context, fileId, metadata) {
  const key = metadata.s3Key || fileId.replace(/^s3:/, '');
  const range = context.request.headers.get('Range');
  return createS3Client(context.env).getObject(key, range ? { range } : {});
}

async function loadDiscord(context, metadata) {
  const { discordChannelId, discordMessageId } = metadata;
  if (!discordChannelId || !discordMessageId) return null;
  const info = await getDiscordFileUrl(discordChannelId, discordMessageId, context.env);
  if (!info) return null;
  const range = context.request.headers.get('Range');
  return fetch(info.url, { headers: range ? { Range: range } : {} });
}

async function loadHuggingFace(context, metadata) {
  if (!metadata.hfPath) return null;
  const range = context.request.headers.get('Range');
  return getHuggingFaceFile(metadata.hfPath, context.env, range ? { range } : {});
}

async function loadWebDav(context, fileId, metadata) {
  const path = metadata.webdavPath || fileId.replace(/^webdav:/, '');
  if (!path) return null;
  const range = context.request.headers.get('Range');
  return getWebDAVFile(path, context.env, range ? { range } : {});
}

async function loadGitHub(context, fileId, metadata) {
  const key = metadata.githubStorageKey || fileId.replace(/^github:/, '');
  const range = context.request.headers.get('Range');
  return getGitHubFile(key, metadata, context.env, range ? { range } : {});
}

const LOADERS = Object.freeze({
  s3: loadS3,
  discord: (context, fileId, metadata) => loadDiscord(context, metadata),
  huggingface: (context, fileId, metadata) => loadHuggingFace(context, metadata),
  webdav: loadWebDav,
  github: loadGitHub,
});

const NOT_FOUND_MESSAGES = Object.freeze({
  s3: 'File not found in S3',
  discord: 'File not found on Discord',
  huggingface: 'File not found on HuggingFace',
  webdav: 'File not found on WebDAV',
  github: 'File not found on GitHub',
});

export async function handleRemoteFile({ context, fileId, record, storageType }) {
  if (!record?.metadata) return errorResponse('File not found', 404);
  const denied = denyListed(context, record.metadata);
  if (denied) return denied;
  const upstream = await LOADERS[storageType](context, fileId, record.metadata);
  const successful = upstream
    && (upstream.ok === true || upstream.status === 200 || upstream.status === 206);
  if (!successful) {
    return errorResponse(NOT_FOUND_MESSAGES[storageType], upstream?.status || 404);
  }
  return responseFromUpstream({
    upstream,
    fileName: record.metadata.fileName || fileId,
  });
}
