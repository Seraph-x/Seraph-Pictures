import { checkAuthentication, isAuthRequired } from "../utils/auth.js";
import { checkGuestUpload, incrementGuestCount, readGuestConfig, getClientIP } from "../utils/guest.js";
import { createS3Client } from "../utils/s3client.js";
import { uploadToDiscord } from "../utils/discord.js";
import { hasHuggingFaceConfig, uploadToHuggingFace } from "../utils/huggingface.js";
import { hasWebDAVConfig, normalizeWebDAVPath, uploadToWebDAV } from "../utils/webdav.js";
import { hasGitHubConfig, normalizeGitHubStoragePath, uploadToGitHub } from "../utils/github.js";
import { assertAllowedRemoteHost, assertPublicRedirect, parseSafeRemoteUrl, RemoteUrlError } from "../utils/remote-url.js";
import { resolveStorageEnv } from "../utils/storage-config.js";
import {
  buildTelegramDirectLink,
  buildTelegramBotApiUrl,
  createSignedTelegramFileId,
  getTelegramCreds,
  getTelegramUploadMethodAndField,
  pickTelegramFileId,
  sendTelegramUploadNotice,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
} from "../utils/telegram.js";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const FETCH_TIMEOUT = 30000;
const MB = 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const url = String(body?.url || "").trim();
    let storageMode = String(body?.storageMode || "telegram").toLowerCase();
    const folderPath = normalizeFolderPath(body?.folderPath || body?.folder || "");

    if (!url) {
      return jsonResponse({ error: "URL is required" }, 400);
    }

    // Gate anonymous (guest) callers: this endpoint used to be fully public.
    const isAdmin = await isUserAuthenticated(context);
    let guestConfig = null;
    if (!isAdmin) {
      guestConfig = await readGuestConfig(env);
      if (!guestConfig.enabled) {
        return jsonResponse({ error: "未启用访客上传，请登录后操作" }, 401);
      }
      // Guests are forced onto the guest Telegram channel.
      storageMode = "telegram";
    }

    try {
      const parsedUrl = parseSafeRemoteUrl(url);
      assertAllowedRemoteHost(parsedUrl, getUrlUploadAllowedHosts(env));
    } catch (error) {
      return jsonResponse({ error: error.message }, error.status || 400);
    }

    const fetched = await fetchRemote(url, env);
    if (!fetched.ok) {
      return jsonResponse({ error: fetched.error }, fetched.status || 502);
    }

    const arrayBuffer = fetched.arrayBuffer;
    const fileSize = arrayBuffer.byteLength;
    if (!fileSize) {
      return jsonResponse({ error: "Remote file is empty" }, 400);
    }
    if (fileSize > MAX_FILE_SIZE) {
      return jsonResponse(
        { error: `File too large (${formatSize(fileSize)}). Max allowed is ${formatSize(MAX_FILE_SIZE)}.` },
        413
      );
    }

    // Enforce guest size/quota now that the real size is known.
    if (!isAdmin) {
      const guestCheck = await checkGuestUpload(request, env, fileSize, guestConfig);
      if (!guestCheck.allowed) {
        return jsonResponse({ error: guestCheck.reason }, guestCheck.status || 403);
      }
    }

    const storageValidation = validateStorageSize(storageMode, fileSize);
    if (!storageValidation.ok) {
      return jsonResponse({ error: storageValidation.message }, storageValidation.status);
    }

    const contentType = fetched.contentType || "application/octet-stream";
    const fileName = buildFileName(fetched.finalUrl, contentType);
    const fileExtension = getFileExtension(fileName);

    // Overlay any KV-stored storage config onto env (KV wins, else env/secret).
    const senv = await resolveStorageEnv(env);

    if (storageMode === "r2") {
      if (!senv.R2_BUCKET) {
        return jsonResponse({ error: "R2 is not configured" }, 400);
      }
      return await uploadToR2(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    if (storageMode === "s3") {
      if (!senv.S3_ENDPOINT || !senv.S3_ACCESS_KEY_ID) {
        return jsonResponse({ error: "S3 is not configured" }, 400);
      }
      return await uploadToS3(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    if (storageMode === "discord") {
      if (!senv.DISCORD_WEBHOOK_URL && !senv.DISCORD_BOT_TOKEN) {
        return jsonResponse({ error: "Discord is not configured" }, 400);
      }
      return await uploadToDiscordStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    if (storageMode === "huggingface") {
      if (!hasHuggingFaceConfig(senv)) {
        return jsonResponse({ error: "HuggingFace is not configured" }, 400);
      }
      return await uploadToHFStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    if (storageMode === "webdav") {
      if (!hasWebDAVConfig(senv)) {
        return jsonResponse({ error: "WebDAV is not configured" }, 400);
      }
      return await uploadToWebDAVStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    if (storageMode === "github") {
      if (!hasGitHubConfig(senv)) {
        return jsonResponse({ error: "GitHub is not configured" }, 400);
      }
      return await uploadToGitHubStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, folderPath);
    }

    const guestOptions = isAdmin
      ? null
      : {
          guest: true,
          guestIp: getClientIP(request),
          retentionDays: guestConfig?.retentionDays ?? 3,
        };
    const telegramResponse = await uploadToTelegram(arrayBuffer, fileName, fileExtension, contentType, fileSize, senv, new URL(request.url).origin, folderPath, guestOptions);
    if (!isAdmin && telegramResponse.status >= 200 && telegramResponse.status < 300) {
      await incrementGuestCount(request, env, guestConfig);
    }
    return telegramResponse;
  } catch (error) {
    console.error("URL upload error:", error);
    return jsonResponse({ error: `Server error: ${error.message}` }, 500);
  }
}

async function isUserAuthenticated(context) {
  const { env } = context;
  if (!isAuthRequired(env)) return true;
  try {
    const auth = await checkAuthentication(context);
    return auth.authenticated;
  } catch {
    return false;
  }
}

async function fetchRemote(url, env = {}) {
  const targetUrl = parseSafeRemoteUrl(url);
  assertAllowedRemoteHost(targetUrl, getUrlUploadAllowedHosts(env));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(targetUrl.toString(), {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 Seraph Pictures URL Uploader",
        Accept: "image/*,video/*,audio/*,application/*,*/*",
      },
    });

    if (isRedirectStatus(response.status)) {
      let redirectUrl;
      try {
        redirectUrl = assertPublicRedirect(response, targetUrl.toString());
        assertAllowedRemoteHost(redirectUrl, getUrlUploadAllowedHosts(env));
      } catch (error) {
        return {
          ok: false,
          status: error.status || 400,
          error: error.message,
        };
      }

      return {
        ok: false,
        status: 400,
        error: `Remote URL redirects to ${redirectUrl.toString()}; follow the final URL explicitly.`,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: `Remote URL error: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const arrayBuffer = await readLimitedBody(response, MAX_FILE_SIZE);

    return {
      ok: true,
      contentType,
      arrayBuffer,
      finalUrl: targetUrl,
    };
  } catch (error) {
    if (error instanceof RemoteUrlError || error.status === 400) {
      return {
        ok: false,
        status: error.status || 400,
        error: error.message,
      };
    }

    if (error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        error: "Remote URL request timed out",
      };
    }

    return {
      ok: false,
      status: 502,
      error: `Cannot fetch remote URL: ${error.message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getUrlUploadAllowedHosts(env = {}) {
  return env.URL_UPLOAD_ALLOWED_HOSTS || env.REMOTE_URL_ALLOWED_HOSTS || "";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(Number(status));
}

async function readLimitedBody(response, maxBytes) {
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength > maxBytes) {
    throw new Error(`Remote file exceeds size limit (${formatSize(maxBytes)}).`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const arrayBuffer = await response.arrayBuffer();
    assertBodySize(arrayBuffer.byteLength, maxBytes);
    return arrayBuffer;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    totalBytes += chunk.byteLength;
    assertBodySize(totalBytes, maxBytes);
    chunks.push(chunk);
  }
  return joinChunks(chunks, totalBytes);
}

function parseContentLength(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function assertBodySize(size, maxBytes) {
  if (size > maxBytes) {
    throw new Error(`Remote file exceeds size limit (${formatSize(maxBytes)}).`);
  }
}

function joinChunks(chunks, totalBytes) {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function validateStorageSize(storageMode, fileSize) {
  const limits = {
    telegram: {
      maxBytes: 20 * MB,
      status: 413,
      message: "Telegram URL upload on Cloudflare Pages is limited to 20MB. Use R2/S3/WebDAV/GitHub for larger files.",
    },
    discord: {
      maxBytes: 25 * MB,
      status: 413,
      message: "Discord upload limit depends on server boost level; Seraph Pictures uses a conservative 25MB default.",
    },
    huggingface: {
      maxBytes: 35 * MB,
      status: 413,
      message: "HuggingFace regular upload is capped at 35MB in Seraph Pictures. Use another storage backend for larger files.",
    },
  };
  const limit = limits[storageMode];
  if (limit && fileSize > limit.maxBytes) {
    return { ok: false, status: limit.status, message: limit.message };
  }
  return { ok: true };
}

function normalizeFolderPath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  const output = [];
  for (const part of raw.split("/")) {
    const piece = part.trim();
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      output.pop();
      continue;
    }
    output.push(piece);
  }
  return output.join("/");
}

function joinStoragePath(folderPath, fileName) {
  const base = normalizeFolderPath(folderPath);
  if (!base) return fileName;
  return `${base}/${fileName}`;
}

function getFileExtension(fileName) {
  const ext = String(fileName || "")
    .split(".")
    .pop()
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, "");
  return ext || "bin";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtensionFromMimeType(mimeType) {
  const type = (mimeType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/x-icon": "ico",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-msvideo": "avi",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/x-m4a": "m4a",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",
    "text/plain": "txt",
    "application/json": "json",
  };
  return map[type] || "bin";
}

function buildFileName(parsedUrl, contentType) {
  let fileName = decodeURIComponent((parsedUrl.pathname.split("/").pop() || "").split("?")[0]);
  if (!fileName) {
    fileName = `url_${Date.now()}.${getExtensionFromMimeType(contentType)}`;
  }

  if (!fileName.includes(".")) {
    fileName = `${fileName}.${getExtensionFromMimeType(contentType)}`;
  }

  return fileName;
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function appendCommonMetadata(metadata, folderPath) {
  if (!folderPath) return metadata;
  return {
    ...metadata,
    folderPath,
  };
}

async function uploadToTelegram(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, fallbackOrigin = "", folderPath = "", guestOptions = null) {
  const isGuest = Boolean(guestOptions);
  const creds = getTelegramCreds(env, { guest: isGuest });
  const blob = new Blob([arrayBuffer], { type: contentType });
  const file = new File([blob], fileName, { type: contentType });

  const formData = new FormData();
  formData.append("chat_id", creds.chatId);

  const { method: apiEndpoint, field } = getTelegramUploadMethodAndField(contentType);
  formData.append(field, file);

  const apiUrl = buildTelegramBotApiUrl(env, apiEndpoint, creds);

  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    return jsonResponse({ error: `Telegram request failed: ${error.message}` }, 502);
  }

  const responseData = await response.json();

  if (!response.ok) {
    if (apiEndpoint === "sendPhoto" || apiEndpoint === "sendAudio") {
      const docFormData = new FormData();
      docFormData.append("chat_id", creds.chatId);
      docFormData.append("document", file);

      const docResponse = await fetch(buildTelegramBotApiUrl(env, "sendDocument", creds), {
        method: "POST",
        body: docFormData,
      });

      const docData = await docResponse.json();
      if (docResponse.ok) {
        return processTelegramSuccess(docData, fileName, fileExtension, contentType, fileSize, env, fallbackOrigin, folderPath, guestOptions);
      }
    }
    return jsonResponse({ error: responseData.description || "Telegram upload failed" }, 500);
  }

  return processTelegramSuccess(responseData, fileName, fileExtension, contentType, fileSize, env, fallbackOrigin, folderPath, guestOptions);
}

async function processTelegramSuccess(responseData, fileName, fileExtension, mimeType, fileSize, env, fallbackOrigin = "", folderPath = "", guestOptions = null) {
  const isGuest = Boolean(guestOptions);
  const fileId = pickTelegramFileId(responseData);
  const messageId = responseData?.result?.message_id;

  if (!fileId) {
    return jsonResponse({ error: "Failed to get Telegram file ID" }, 500);
  }

  // Guests always use a plain (non-signed) id so the KV record drives TTL expiry.
  const useSigned = !isGuest && shouldUseSignedTelegramLinks(env);
  const directId = useSigned
    ? await createSignedTelegramFileId({ fileId, fileExtension, fileName, mimeType, fileSize, messageId }, env)
    : `${fileId}.${fileExtension}`;

  // Guests always persist a KV record (with TTL); admins follow the metadata flag.
  if (env.img_url && (isGuest || shouldWriteTelegramMetadata(env))) {
    const metadata = appendCommonMetadata(
      {
        TimeStamp: Date.now(),
        ListType: "None",
        Label: "None",
        liked: false,
        fileName,
        fileSize,
        storageType: "telegram",
        telegramFileId: fileId,
        telegramMessageId: messageId || undefined,
        signedLink: useSigned,
        ...(isGuest
          ? { guest: true, guestIp: guestOptions.guestIp, tgBot: "guest" }
          : {}),
      },
      folderPath
    );

    const putOptions = { metadata };
    if (isGuest) {
      const days = Math.max(0, Math.round(Number(guestOptions.retentionDays)) || 0);
      if (days > 0) putOptions.expirationTtl = days * 86400;
    }
    await env.img_url.put(`${fileId}.${fileExtension}`, "", putOptions);
  }

  // The upload notice targets the admin channel via the main bot; skip for guests.
  if (!isGuest) {
    const directLink = buildTelegramDirectLink(env, directId, fallbackOrigin);
    try {
      const noticeResult = await sendTelegramUploadNotice(
        {
          chatId: env.TG_Chat_ID,
          replyToMessageId: messageId || undefined,
          directLink,
          fileId,
          messageId,
          fileName,
          fileSize,
        },
        env
      );
      if (!noticeResult?.ok && !noticeResult?.skipped) {
        console.warn(
          "Telegram upload notice failed:",
          noticeResult?.data?.description || noticeResult?.error || "unknown error"
        );
      }
    } catch (error) {
      console.warn("Telegram upload notice error:", error.message);
    }
  }

  return jsonResponse([{ src: `/file/${directId}` }]);
}

async function uploadToR2(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, folderPath = "") {
  try {
    const fileId = randomId("r2");
    const objectKey = `${fileId}.${fileExtension}`;

    await env.R2_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType },
      customMetadata: { fileName, uploadTime: Date.now().toString() },
    });

    if (env.img_url) {
      await env.img_url.put(`r2:${objectKey}`, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "r2",
            r2Key: objectKey,
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/r2:${objectKey}` }]);
  } catch (error) {
    console.error("R2 upload error:", error);
    return jsonResponse({ error: `R2 upload failed: ${error.message}` }, 500);
  }
}

async function uploadToS3(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, folderPath = "") {
  try {
    const s3 = createS3Client(env);
    const fileId = randomId("s3");
    const objectKey = `${fileId}.${fileExtension}`;

    await s3.putObject(objectKey, arrayBuffer, {
      contentType,
      metadata: {
        "x-amz-meta-filename": fileName,
        "x-amz-meta-uploadtime": Date.now().toString(),
      },
    });

    if (env.img_url) {
      await env.img_url.put(`s3:${objectKey}`, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "s3",
            s3Key: objectKey,
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/s3:${objectKey}` }]);
  } catch (error) {
    console.error("S3 upload error:", error);
    return jsonResponse({ error: `S3 upload failed: ${error.message}` }, 500);
  }
}

async function uploadToDiscordStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, folderPath = "") {
  try {
    const result = await uploadToDiscord(arrayBuffer, fileName, contentType, env);

    if (!result.success) {
      return jsonResponse({ error: `Discord upload failed: ${result.error}` }, 500);
    }

    const fileId = randomId("discord");
    const kvKey = `discord:${fileId}.${fileExtension}`;

    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "discord",
            discordChannelId: result.channelId,
            discordMessageId: result.messageId,
            discordAttachmentId: result.attachmentId,
            discordUploadMode: result.mode,
            discordSourceUrl: result.sourceUrl,
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/${kvKey}` }]);
  } catch (error) {
    console.error("Discord upload error:", error);
    return jsonResponse({ error: `Discord upload failed: ${error.message}` }, 500);
  }
}

async function uploadToHFStorage(arrayBuffer, fileName, fileExtension, _contentType, fileSize, env, folderPath = "") {
  try {
    const fileId = randomId("hf");
    const hfPath = joinStoragePath(folderPath, `${fileId}.${fileExtension}`);

    const result = await uploadToHuggingFace(arrayBuffer, hfPath, fileName, env);
    if (!result.success) {
      return jsonResponse({ error: `HuggingFace upload failed: ${result.error}` }, 500);
    }

    const kvKey = `hf:${fileId}.${fileExtension}`;

    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "huggingface",
            hfPath,
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/${kvKey}` }]);
  } catch (error) {
    console.error("HuggingFace upload error:", error);
    return jsonResponse({ error: `HuggingFace upload failed: ${error.message}` }, 500);
  }
}

async function uploadToWebDAVStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, folderPath = "") {
  try {
    const fileId = randomId("wd");
    const publicId = `${fileId}.${fileExtension}`;
    const webdavPath = joinStoragePath(folderPath, publicId);

    const result = await uploadToWebDAV(arrayBuffer, webdavPath, contentType || "application/octet-stream", env);

    const kvKey = `webdav:${publicId}`;
    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "webdav",
            webdavPath: normalizeWebDAVPath(result.path || webdavPath),
            webdavEtag: result.etag || undefined,
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/${kvKey}` }]);
  } catch (error) {
    console.error("WebDAV upload error:", error);
    return jsonResponse({ error: `WebDAV upload failed: ${error.message}` }, 500);
  }
}

async function uploadToGitHubStorage(arrayBuffer, fileName, fileExtension, contentType, fileSize, env, folderPath = "") {
  try {
    const fileId = randomId("github");
    const publicId = `${fileId}.${fileExtension}`;
    const githubStorageKey = joinStoragePath(folderPath, publicId);

    const result = await uploadToGitHub(
      arrayBuffer,
      normalizeGitHubStoragePath(githubStorageKey),
      fileName,
      contentType || "application/octet-stream",
      env
    );

    const kvKey = `github:${publicId}`;
    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize,
            storageType: "github",
            githubStorageKey: normalizeGitHubStoragePath(result.storagePath || githubStorageKey),
            ...(result.metadata || {}),
          },
          folderPath
        ),
      });
    }

    return jsonResponse([{ src: `/file/${kvKey}` }]);
  } catch (error) {
    console.error("GitHub upload error:", error);
    return jsonResponse({ error: `GitHub upload failed: ${error.message}` }, 500);
  }
}
