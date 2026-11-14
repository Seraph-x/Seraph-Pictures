{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async startUpload() {
            const waiting = this.uploadingFiles.filter(
              (f) => f.status === "waiting",
            );
            if (waiting.length === 0) return;

            // Telegram 模式串行上传，每个文件之间 500ms 延迟，避免频率限制
            const telegramItems = waiting.filter(
              (item) => this.getItemStorageMode(item) === "telegram",
            );
            const otherItems = waiting.filter(
              (item) => this.getItemStorageMode(item) !== "telegram",
            );

            for (let i = 0; i < telegramItems.length; i++) {
              await this.uploadFile(telegramItems[i]);
              if (i < telegramItems.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
            }

            // 其他存储模式使用并发上传
            const concurrent = this.uploadConfig.maxConcurrent;
            for (let i = 0; i < otherItems.length; i += concurrent) {
              const batch = otherItems.slice(i, i + concurrent);
              await Promise.all(batch.map((item) => this.uploadFile(item)));
            }

            // 上传完成
            const successCount = waiting.filter(
              (f) => f.status === "success",
            ).length;
            if (successCount > 0) {
              const targets = [
                ...new Set(waiting.map((item) => this.getItemStorageTarget(item))),
              ];
              const targetText = targets.length === 1 ? targets[0] : this.t('home.multipleTargets');
              this.showToast(
                this.t('home.toastUploadSuccess', { count: successCount, target: targetText }),
                "success",
              );
            }

            // 清理完成的上传项
            setTimeout(() => {
              this.uploadingFiles = this.uploadingFiles.filter(
                (f) => f.status !== "success",
              );
            }, 2000);
          },
async uploadFile(item) {
            try {
              await this.prepareUploadItem(item);
              this.validateUploadItemSize(item);
              item.status = "uploading";
              item.progress = 0;
              item.isChunked = this.shouldUseChunkedUpload(item);
              // 根据文件大小决定使用普通上传还是分片上传
              if (item.isChunked) {
                await this.chunkedUpload(item);
              } else {
                await this.directUpload(item);
              }
            } catch (err) {
              item.status = "error";
              item.error = err.message;
              console.error("Upload error:", err);
            }
          },
async directUpload(item) {
            const formData = new FormData();
            formData.append("file", item.file);
            LegacyUploadProfiles.appendUploadTarget(formData, {
              storageMode: this.getItemStorageMode(item),
              storageId: this.getItemStorageId(item),
              folderPath: this.getItemFolderPath(item),
            });

            const response = await fetch(`${this.baseURL}/upload`, {
              method: "POST",
              body: formData,
              credentials: "include",
            });

            const data = await response.json();

            if (!response.ok || (Array.isArray(data) && data[0]?.error)) {
              const serverError = Array.isArray(data)
                ? data[0]?.error
                : data?.error;
              throw new Error(serverError || this.t('home.toastUploadFailed'));
            }

            const src = data[0]?.src;
            if (!src) throw new Error(this.t('home.errNoPath'));

            item.status = "success";
            item.progress = 100;
            this.handleUploadSuccess(item, src);
          },
async sha256Hex(value) {
            const hash = await crypto.subtle.digest("SHA-256", value);
            return Array.from(new Uint8Array(hash), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("");
          },
async createMultipartDigestPlan(file, chunkSize) {
            const partDigests = [];
            const totalParts = Math.ceil(file.size / chunkSize);
            for (let index = 0; index < totalParts; index++) {
              const start = index * chunkSize;
              const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
              partDigests.push(await this.sha256Hex(await chunk.arrayBuffer()));
            }
            const manifest = new TextEncoder().encode(partDigests.join(":"));
            return {
              partDigests,
              rootDigest: await this.sha256Hex(manifest),
            };
          },
async cancelMultipartUpload(uploadId) {
            const response = await fetch(
              `${this.baseURL}/api/chunked-upload/cancel`,
              {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uploadId }),
                credentials: "include",
              },
            );
            if (!response.ok) {
              const body = await response.json();
              throw new Error(body.error || "MULTIPART_CANCEL_FAILED");
            }
          },
async initializeMultipart(options) {
            const target = {
              storageMode: this.getItemStorageMode(options.item),
              storageId: this.getItemStorageId(options.item),
              folderPath: this.getItemFolderPath(options.item),
            };
            const body = {
              ...LegacyUploadProfiles.buildMultipartInit({ file: options.file, target }),
              totalChunks: options.totalChunks, rootDigest: options.digests.rootDigest,
            };
            const response = await fetch(`${this.baseURL}/api/chunked-upload/init`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body), credentials: 'include',
            });
            const data = await response.json();
            if (!response.ok || !data.uploadId) throw new Error(data.error || this.t('home.errInitUpload'));
            return data.uploadId;
          },
async uploadMultipartParts(options) {
            for (let index = 0; index < options.totalChunks; index += 1) {
              const start = index * options.chunkSize;
              const chunk = options.file.slice(start, Math.min(start + options.chunkSize, options.file.size));
              const formData = new FormData();
              formData.append('chunk', chunk);
              formData.append('uploadId', options.uploadId);
              formData.append('chunkIndex', index);
              formData.append('digest', options.digests.partDigests[index]);
              const response = await fetch(`${this.baseURL}/api/chunked-upload/chunk`, {
                method: 'POST', body: formData, credentials: 'include',
              });
              if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || this.t('home.errChunkUpload', { index: index + 1 }));
              }
              options.item.progress = Math.round(((index + 1) / options.totalChunks) * 90);
            }
          },
async completeMultipart(uploadId) {
            const response = await fetch(`${this.baseURL}/api/chunked-upload/complete`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uploadId }), credentials: 'include',
            });
            const data = await response.json();
            if (!response.ok || !data.src) throw new Error(data.error || this.t('home.errMergeChunk'));
            return data.src;
          },
async failMultipartUpload(options) {
            try {
              await this.cancelMultipartUpload(options.uploadId);
            } catch (cleanupError) {
              throw new Error(`${options.error.message}; cleanup: ${cleanupError.message}`);
            }
            throw options.error;
          },
async chunkedUpload(item) {
            const file = item.file;
            const chunkSize = this.uploadConfig.chunkSize;
            const totalChunks = Math.ceil(file.size / chunkSize);
            const digests = await this.createMultipartDigestPlan(file, chunkSize);
            const uploadId = await this.initializeMultipart({ item, file, totalChunks, digests });
            try {
              await this.uploadMultipartParts({ item, file, chunkSize, totalChunks, digests, uploadId });
              const src = await this.completeMultipart(uploadId);
              item.status = 'success';
              item.progress = 100;
              this.handleUploadSuccess(item, src);
            } catch (error) {
              await this.failMultipartUpload({ uploadId, error });
            }
          },
handleUploadSuccess(item, src) {
            const uploadedFile = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: item.file.name, // 原始文件名
              fileName: item.file.name, // 保存原始文件名用于显示
              url: `${this.baseURL}${src}`,
              path: src,
              size: item.file.size,
              selected: false,
              uploadTime: Date.now(),
              storageMode: item.uploadTarget.storageMode,
              storageId: item.uploadTarget.storageId,
              storageName: item.uploadTarget.storageName,
            };

            this.uploadedFiles.unshift(uploadedFile);
            this.addToHistory(uploadedFile);
          },
formatLink(file) {
            // 使用核心方法获取干净的文件直链
            const url = this.getCleanFileUrl(file);
            const name = this.getDisplayName(file);
            switch (this.linkFormat) {
              case "markdown":
                return `![${name}](${url})`;
              case "html":
                return `<img src="${url}" alt="${name}">`;
              case "bbcode":
                return `[img]${url}[/img]`;
              case "ubb":
                return `[IMG]${url}[/IMG]`;
              default:
                return url;
            }
          },
getBatchLinks() {
            const selected = this.uploadedFiles.filter((f) => f.selected);
            const files = selected.length > 0 ? selected : this.uploadedFiles;
            return files.map((f) => this.formatLink(f)).join("\n");
          }
  }});
}
