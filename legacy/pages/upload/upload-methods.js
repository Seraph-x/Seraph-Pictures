{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
createUploadContext() {
            const folderPath = this.normalizeFolderPath(this.folderPath);
            if (this.isGuest) {
              return Object.freeze({
                storageMode: 'telegram', storageId: '',
                storageName: this.t('home.tgChannel'), folderPath,
              });
            }
            const profile = this.storageProfiles.find((item) => item.id === this.storageId);
            return LegacyUploadProfiles.snapshotUploadTarget({
              storageMode: this.storageMode, profile, folderPath,
            });
          },
getImageFormatConfig(format) {
            return (
              this.imageCompressFormats.find((item) => item.value === format) ||
              this.imageCompressFormats[0]
            );
          },
isFormatSupported(format) {
            return this.imageCompress.support?.[format] !== false;
          },
loadImageUploadDecision() {
            const saved = localStorage.getItem('kvault:image-upload-decision');
            if (['original', 'optimized', 'ask'].includes(saved)) this.imageUploadDecision = saved;
          },
setImageUploadDecision(decision) {
            if (!["original", "optimized", "ask"].includes(decision)) return;
            this.imageUploadDecision = decision;
            localStorage.setItem('kvault:image-upload-decision', decision);
          },
storageEnabledFromStatus(statusItem) {
            return !!(
              statusItem &&
              (statusItem.connected || statusItem.configured) &&
              statusItem.enabled !== false
            );
          },
getUploadLimit(storageMode) {
            const fallback = {
              telegram: {
                maxBytes: 20 * 1024 * 1024,
                directThreshold: 20 * 1024 * 1024,
                supportsChunkUpload: false,
              },
              r2: {
                maxBytes: this.uploadConfig.maxSize,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
              s3: {
                maxBytes: this.uploadConfig.maxSize,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
              discord: {
                maxBytes: 25 * 1024 * 1024,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
              huggingface: {
                maxBytes: 35 * 1024 * 1024,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
              webdav: {
                maxBytes: this.uploadConfig.maxSize,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
              github: {
                maxBytes: this.uploadConfig.maxSize,
                directThreshold: this.uploadConfig.smallFileThreshold,
                supportsChunkUpload: true,
              },
            };
            const base = fallback[storageMode] || fallback.telegram;
            return {
              ...base,
              ...(this.uploadLimits?.[storageMode] || {}),
            };
          },
validateUploadItemSize(item) {
            const limit = this.getUploadLimit(this.getItemStorageMode(item));
            const maxBytes =
              this.isGuest && this.guestUploadConfig
                ? Math.min(limit.maxBytes || Infinity, this.guestUploadConfig.maxFileSize)
                : limit.maxBytes;
            if (maxBytes && item.file.size > maxBytes) {
              throw new Error(
                `${this.getItemStorageTarget(item)} limit is ${this.formatSize(maxBytes)}. ` +
                  `Use R2/S3/WebDAV/GitHub for larger browser uploads.`
              );
            }
          },
shouldUseChunkedUpload(item) {
            if (this.isGuest) return false;
            const limit = this.getUploadLimit(this.getItemStorageMode(item));
            if (limit.supportsChunkUpload === false) return false;
            const threshold =
              limit.directThreshold || this.uploadConfig.smallFileThreshold;
            return item.file.size > threshold;
          },
async detectImageCompressionSupport() {
            if (!document.createElement("canvas").toBlob) return;
            const canvas = document.createElement("canvas");
            canvas.width = 1;
            canvas.height = 1;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, 1, 1);
            }

            await Promise.all(
              this.imageCompressFormats.map(
                (format) =>
                  new Promise((resolve) => {
                    canvas.toBlob(
                      (blob) => {
                        const supported = !!blob && blob.type === format.mime;
                        this.$set(this.imageCompress.support, format.value, supported);
                        resolve();
                      },
                      format.mime,
                      0.82,
                    );
                  }),
              ),
            );

            if (!this.isFormatSupported(this.imageCompress.format)) {
              const fallback = this.imageCompressFormats.find((format) =>
                this.isFormatSupported(format.value),
              );
              if (fallback) this.imageCompress.format = fallback.value;
            }
          },
loadImageCompressSettings() {
            const raw = localStorage.getItem('imageCompressSettings');
            if (!raw) return;
            let settings;
            try { settings = JSON.parse(raw); }
            catch (cause) { throw Object.assign(new Error('IMAGE_COMPRESS_SETTINGS_INVALID'), { cause }); }
            if (typeof settings.enabled === 'boolean') this.imageCompress.enabled = settings.enabled;
            if (settings.format) this.imageCompress.format = settings.format;
            if (settings.quality) this.imageCompress.quality = settings.quality;
            if (settings.maxDimension !== undefined) this.imageCompress.maxDimension = settings.maxDimension;
            if (typeof settings.keepOriginalWhenLarger === 'boolean') {
              this.imageCompress.keepOriginalWhenLarger = settings.keepOriginalWhenLarger;
            }
            this.normalizeImageCompressSettings();
          },
normalizeImageCompressSettings() {
            const quality = Number(this.imageCompress.quality) || 82;
            const maxDimension = Number(this.imageCompress.maxDimension) || 0;
            this.imageCompress.quality = Math.min(95, Math.max(30, quality));
            this.imageCompress.maxDimension = Math.min(
              12000,
              Math.max(0, Math.round(maxDimension)),
            );
            if (
              !this.imageCompressFormats.some(
                (format) => format.value === this.imageCompress.format,
              )
            ) {
              this.imageCompress.format = "webp";
            }
          },
saveImageCompressSettings() {
            this.normalizeImageCompressSettings();
            localStorage.setItem('imageCompressSettings', JSON.stringify({
              enabled: this.imageCompress.enabled, format: this.imageCompress.format,
              quality: this.imageCompress.quality, maxDimension: this.imageCompress.maxDimension,
              keepOriginalWhenLarger: this.imageCompress.keepOriginalWhenLarger,
            }));
          },
selectCompressFormat(format) {
            if (!this.isFormatSupported(format)) return;
            this.imageCompress.format = format;
            this.saveImageCompressSettings();
          },
snapshotImageCompressOptions(enabled) {
            this.normalizeImageCompressSettings();
            const format = this.getImageFormatConfig(this.imageCompress.format);
            return {
              enabled: !!enabled,
              format: format.value,
              quality: this.imageCompress.quality,
              maxDimension: this.imageCompress.maxDimension,
              keepOriginalWhenLarger: this.imageCompress.keepOriginalWhenLarger,
            };
          },
isCompressibleImage(file) {
            const type = (file.type || "").toLowerCase();
            if (!type.startsWith("image/")) return false;
            return !["image/gif", "image/svg+xml"].includes(type);
          },
validateUploadFiles(files) {
            const valid = [];
            const invalid = [];

            const selectedLimit = this.getUploadLimit(this.storageMode);
            const maxSize =
              this.isGuest && this.guestUploadConfig
                ? Math.min(
                    selectedLimit.maxBytes || Infinity,
                    this.guestUploadConfig.maxFileSize,
                  )
                : selectedLimit.maxBytes || this.uploadConfig.maxSize;
            const maxSizeLabel = this.formatSize(maxSize);

            files.forEach((file) => {
              if (file.size > maxSize) {
                invalid.push(file.name);
              } else {
                valid.push(file);
              }
            });

            if (invalid.length > 0) {
              this.showToast(
                this.t('home.toastOverLimit', { count: invalid.length, limit: maxSizeLabel }),
                "error",
              );
            }

            if (valid.length === 0) return;
            return valid;
          }
  }});
}
