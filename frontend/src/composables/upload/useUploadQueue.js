function requiredText(value, code) {
  const normalized = String(value || '').trim();
  if (!normalized) throw Object.assign(new Error(code), { code });
  return normalized;
}

function snapshotTarget(target) {
  return Object.freeze({
    storageMode: requiredText(target?.storageMode, 'STORAGE_SELECTION_REQUIRED'),
    storageId: requiredText(target?.storageId, 'STORAGE_SELECTION_REQUIRED'),
    storageName: requiredText(target?.storageName, 'STORAGE_SELECTION_REQUIRED'),
    targetFolderPath: String(target?.targetFolderPath || ''),
  });
}

export function createUploadQueueItem(options) {
  const target = snapshotTarget(options.target);
  return {
    id: requiredText(options.id, 'UPLOAD_QUEUE_ID_REQUIRED'),
    file: options.file,
    target,
    progress: 0,
    status: 'pending',
    error: '',
    imageProcessingOptions: Object.freeze({ ...(options.imageProcessingOptions || {}) }),
    imageProcessingPrepared: false,
    optimizationNote: '',
  };
}

function enqueue(context, files, target, imageProcessingOptions) {
  const created = files.map((file) => createUploadQueueItem({
    id: context.createId(), file, target, imageProcessingOptions,
  }));
  context.queue.value.push(...created);
  void processQueue(context);
  return Object.freeze([...created]);
}

function uploadLimit(context, item) {
  return context.getUploadLimit(context.status.value, item.target.storageMode);
}

function validateSize(context, item) {
  const limit = uploadLimit(context, item);
  const maxBytes = Number(limit.maxBytes || 0);
  if (maxBytes > 0 && item.file.size > maxBytes) {
    throw new Error(limit.message || context.t('uv.errLimit', {
      label: item.target.storageName, size: context.formatSize(maxBytes),
    }));
  }
  const threshold = Number(limit.directThreshold || context.chunkSize);
  if (item.file.size > threshold && limit.supportsChunkUpload === false) {
    throw new Error(limit.message || context.t('uv.errNoChunk', {
      label: item.target.storageName, size: context.formatSize(threshold),
    }));
  }
}

function shouldChunk(context, item) {
  const limit = uploadLimit(context, item);
  return item.file.size > Number(limit.directThreshold || context.chunkSize)
    && limit.supportsChunkUpload !== false;
}

async function cancelMultipart(context, item, cause) {
  if (!item.multipartUploadId) return cause.message;
  try {
    await context.apiFetch('/api/chunked-upload/cancel', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: item.multipartUploadId }),
    });
    item.multipartUploadId = null;
    return cause.message;
  } catch (cleanupError) {
    return `${cause.message}; cleanup: ${cleanupError.message}`;
  }
}

async function uploadItem(context, item) {
  const profile = context.profiles.value.find((entry) => entry.id === item.target.storageId);
  if (!profile?.enabled || profile.type !== item.target.storageMode) throw new Error('STORAGE_NOT_WRITABLE');
  await context.prepareQueuedImage(item);
  validateSize(context, item);
  item.status = 'uploading';
  const link = shouldChunk(context, item)
    ? await context.transport.chunkUpload(item)
    : await context.transport.directUpload(item);
  item.status = 'success';
  item.progress = 100;
  context.results.value.unshift({ id: item.id, fileName: item.file.name, link, target: item.target });
}

async function processQueue(context) {
  if (context.uploading.value) return;
  context.uploading.value = true;
  context.error.value = '';
  try {
    for (const item of context.queue.value) {
      if (item.status !== 'pending') continue;
      try {
        await uploadItem(context, item);
      } catch (cause) {
        item.status = 'error';
        item.error = context.humanizeError(await cancelMultipart(context, item, cause));
      }
    }
  } finally {
    context.uploading.value = false;
  }
}

export function useUploadQueue(options) {
  const context = Object.freeze({ ...options });
  return Object.freeze({
    enqueue: (files, target, imageOptions) => enqueue(context, files, target, imageOptions),
    processQueue: () => processQueue(context),
  });
}
