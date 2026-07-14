{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
t(key, params) {
            // reference this.lang so templates re-render on language switch
            void this.lang;
            return window.I18n ? I18n.t(key, params) : key;
          },
handleBrandLogoClick() {
            if (!this.isGuest) {
              window.location.href = "/";
              return;
            }
            const currentPath =
              window.location.pathname + window.location.search;
            window.location.href =
              "/login?redirect=" + encodeURIComponent(currentPath || "/");
          },
normalizeFolderPath(value) {
            const parts = String(value || "")
              .replace(/\\/g, "/")
              .split("/");
            const normalized = [];
            parts.forEach((part) => {
              const cleaned = String(part || "").trim();
              if (!cleaned || cleaned === ".") return;
              if (cleaned === "..") {
                normalized.pop();
                return;
              }
              normalized.push(cleaned);
            });
            return normalized.join("/");
          },
handleFolderPathInput() {
            this.folderPath = this.normalizeFolderPath(this.folderPath);
            localStorage.setItem('uploadFolderPath', this.folderPath);
          },
clearFolderPath() {
            this.folderPath = "";
            localStorage.setItem('uploadFolderPath', '');
          },
triggerUpload() {
            this.$refs.fileInput.click();
          },
handleFileSelect(event) {
            const files = Array.from(event.target.files || []);
            this.prepareFilesForUpload(files);
            event.target.value = "";
          },
onDragOver() {
            this.isDragging = true;
          },
onDragLeave() {
            this.isDragging = false;
          },
onDrop(event) {
            this.isDragging = false;
            const files = Array.from(event.dataTransfer.files || []);
            this.prepareFilesForUpload(files);
          },
async clipboardItemFiles(item) {
            const imageTypes = item.types.filter((type) => type.startsWith('image/'));
            return Promise.all(imageTypes.map(async (type) => {
              const blob = await item.getType(type);
              const extension = type.split('/')[1];
              return new File([blob], `clipboard_${Date.now()}.${extension}`, { type });
            }));
          },
async pasteFromClipboard() {
            try {
              const items = await navigator.clipboard.read();
              const groups = await Promise.all(items.map((item) => this.clipboardItemFiles(item)));
              const files = groups.flat();
              if (!files.length) {
                this.showToast(this.t('home.toastNoClipImg'), 'error');
                return;
              }
              this.prepareFilesForUpload(files);
            } catch (err) {
              this.showToast(this.t('home.toastNoClipAccess'), "error");
              throw err;
            }
          },
validateRemoteUrl(value) {
            const raw = String(value || '').trim();
            if (!raw) throw new Error(this.t('home.toastInvalidUrl'));
            const parsed = new URL(raw);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
              throw new Error(this.t('home.toastUrlProtocol'));
            }
            return parsed.toString();
          },
async requestUrlUpload(options) {
            const response = await fetch(`${this.baseURL}/api/upload-from-url`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(LegacyUploadProfiles.buildUrlUploadPayload(options)),
              credentials: 'include',
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || this.t('home.toastUploadFailed'));
            if (!Array.isArray(data) || !data[0]?.src) throw new Error('URL_UPLOAD_RESPONSE_INVALID');
            return data[0].src;
          },
recordUrlUpload(options) {
            const sourceName = new URL(options.url).pathname.split('/').pop() || 'url_image';
            const uploadedFile = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: sourceName, fileName: sourceName,
              url: `${this.baseURL}${options.src}`, path: options.src, size: 0,
              selected: false, uploadTime: Date.now(),
              storageMode: options.target.storageMode,
              storageId: options.target.storageId,
              storageName: options.target.storageName,
            };
            this.uploadedFiles.unshift(uploadedFile);
            this.addToHistory(uploadedFile);
          },
async uploadFromUrl() {
            this.urlUploading = true;
            try {
              const url = this.validateRemoteUrl(this.urlToUpload);
              const target = this.createUploadContext();
              const src = await this.requestUrlUpload({ url, target });
              this.recordUrlUpload({ url, src, target });
              this.showToast(this.t('home.toastUrlSuccess', { target: this.storageTarget }), 'success');
              this.urlToUpload = '';
            } catch (error) {
              this.showToast(this.t('home.toastUrlFailed', { msg: error.message }), 'error');
            } finally {
              this.urlUploading = false;
            }
          }
  }});
}
