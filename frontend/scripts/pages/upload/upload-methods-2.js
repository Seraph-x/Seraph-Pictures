{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async prepareFilesForUpload(files) {
            const valid = this.validateUploadFiles(files);
            if (!valid || valid.length === 0) return;

            const context = this.createUploadContext();
            const imageCount = valid.filter((file) =>
              this.isCompressibleImage(file),
            ).length;

            if (imageCount > 0) {
              if (this.imageUploadDecision !== "ask") {
                await this.processFiles(
                  valid,
                  this.snapshotImageCompressOptions(
                    this.imageUploadDecision === "optimized",
                  ),
                  context,
                );
                return;
              }

              this.pendingUploadBatch = { files: valid, context };
              this.pendingCompressionChoice = this.imageCompress.enabled
                ? "compress"
                : "original";
              return;
            }

            await this.processFiles(
              valid,
              this.snapshotImageCompressOptions(false),
              context,
            );
          },
setPendingCompressionMode(mode) {
            this.pendingCompressionChoice = mode;
          },
cancelPendingUpload() {
            this.pendingUploadBatch = null;
            this.pendingCompressionChoice = "original";
          },
consumePendingUploadBatch() {
            const batch = this.pendingUploadBatch;
            this.pendingUploadBatch = null;
            return batch;
          },
async uploadPendingOriginal() {
            const batch = this.consumePendingUploadBatch();
            if (!batch) return;
            this.pendingCompressionChoice = "original";
            await this.processFiles(
              batch.files,
              this.snapshotImageCompressOptions(false),
              batch.context,
            );
          },
async uploadPendingCompressed() {
            const batch = this.consumePendingUploadBatch();
            if (!batch) return;
            this.pendingCompressionChoice = "compress";
            await this.processFiles(
              batch.files,
              this.snapshotImageCompressOptions(true),
              batch.context,
            );
          },
getItemStorageMode(item) {
            if (!item.uploadTarget?.storageMode) throw new Error('UPLOAD_TARGET_SNAPSHOT_MISSING');
            return item.uploadTarget.storageMode;
          },
getItemStorageTarget(item) {
            const target = item.uploadTarget;
            if (!target?.storageName) throw new Error('UPLOAD_TARGET_SNAPSHOT_MISSING');
            return `${target.storageMode} · ${target.storageName}`;
          },
getItemStorageId(item) {
            if (item.uploadTarget?.storageId || this.isGuest) return item.uploadTarget?.storageId || '';
            throw new Error('UPLOAD_TARGET_SNAPSHOT_MISSING');
          },
getItemFolderPath(item) {
            return this.normalizeFolderPath(item.uploadTarget?.folderPath || '');
          },
replaceFileExtension(name, ext) {
            const safeExt = String(ext || "").replace(/^\./, "");
            if (!safeExt) return name;
            const base = String(name || "image").replace(/\.[^/.]+$/, "");
            return `${base}.${safeExt}`;
          },
loadImageFromFile(file) {
            return new Promise((resolve, reject) => {
              const url = URL.createObjectURL(file);
              const image = new Image();
              image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
              };
              image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error(this.t('home.errDecode')));
              };
              image.src = url;
            });
          },
canvasToBlob(canvas, mime, quality) {
            return new Promise((resolve, reject) => {
              if (!canvas.toBlob) {
                reject(new Error(this.t('home.errNoCompress')));
                return;
              }
              canvas.toBlob(
                (blob) => {
                  if (!blob) {
                    reject(new Error(this.t('home.errCompressFail')));
                    return;
                  }
                  resolve(blob);
                },
                mime,
                quality,
              );
            });
          },
imageCompressionDimensions(image, maxDimensionValue) {
            const naturalWidth = image.naturalWidth || image.width;
            const naturalHeight = image.naturalHeight || image.height;
            if (!naturalWidth || !naturalHeight) throw new Error(this.t('home.errReadSize'));
            const maxDimension = Number(maxDimensionValue) || 0;
            const ratio = maxDimension > 0 && Math.max(naturalWidth, naturalHeight) > maxDimension
              ? maxDimension / Math.max(naturalWidth, naturalHeight) : 1;
            return Object.freeze({
              naturalWidth, naturalHeight,
              width: Math.max(1, Math.round(naturalWidth * ratio)),
              height: Math.max(1, Math.round(naturalHeight * ratio)),
            });
          },
drawImageCanvas(options) {
            const canvas = document.createElement('canvas');
            canvas.width = options.width;
            canvas.height = options.height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error(this.t('home.errCanvas'));
            if (options.mime === 'image/jpeg') {
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, options.width, options.height);
            }
            context.drawImage(options.image, 0, 0, options.width, options.height);
            return canvas;
          },
imageCompressionResult(options) {
            const compressed = new File(
              [options.blob], this.replaceFileExtension(options.file.name, options.format.ext),
              { type: options.format.mime, lastModified: options.file.lastModified },
            );
            return Object.freeze({
              file: compressed, changed: true, formatLabel: options.format.label,
              originalSize: options.file.size, outputSize: compressed.size,
              resized: options.dimensions.width !== options.dimensions.naturalWidth
                || options.dimensions.height !== options.dimensions.naturalHeight,
            });
          },
async compressImageFile(file, options) {
            if (!options.enabled || !this.isCompressibleImage(file)) return { file, changed: false };
            const format = this.getImageFormatConfig(options.format);
            if (!this.isFormatSupported(format.value)) {
              return { file, changed: false, reason: this.t('home.reasonUnsupported', { label: format.label }) };
            }
            const image = await this.loadImageFromFile(file);
            const dimensions = this.imageCompressionDimensions(image, options.maxDimension);
            const canvas = this.drawImageCanvas({ image, mime: format.mime, ...dimensions });
            const blob = await this.canvasToBlob(canvas, format.mime, options.quality / 100);
            if (blob.type && blob.type !== format.mime) {
              return { file, changed: false, reason: this.t('home.reasonUnsupported', { label: format.label }) };
            }
            if (options.keepOriginalWhenLarger && blob.size >= file.size) {
              return { file, changed: false, reason: this.t('home.reasonNotSmaller') };
            }
            return this.imageCompressionResult({ file, blob, format, dimensions });
          },
async prepareUploadItem(item) {
            if (item.imageCompressionPrepared) return;
            item.imageCompressionPrepared = true;
            const options = item.imageCompressOptions || {
              enabled: false,
            };

            if (!options.enabled || !this.isCompressibleImage(item.originalFile)) {
              return;
            }

            const format = this.getImageFormatConfig(options.format);
            item.status = "processing";
            item.compressionStatus = this.t('home.statusConverting', { label: format.label });

            try {
              const result = await this.compressImageFile(
                item.originalFile,
                options,
              );
              if (!result.changed) {
                item.compressionStatus = result.reason || this.t('home.statusSkipped');
                return;
              }

              item.file = result.file;
              item.name = result.file.name;
              item.size = result.file.size;
              if (item.preview) URL.revokeObjectURL(item.preview);
              item.preview = URL.createObjectURL(result.file);
              const saved = Math.max(
                0,
                result.originalSize - result.outputSize,
              );
              const resizedText = result.resized ? this.t('home.resizedSuffix') : "";
              item.compressionStatus = this.t('home.statusConverted', { label: result.formatLabel, saved: this.formatSize(saved), resized: resizedText });
            } catch (err) {
              console.warn("Image compression skipped:", err);
              item.compressionStatus = this.t('home.statusCompressFailed', { msg: err.message });
            }
          }
  }});
}
