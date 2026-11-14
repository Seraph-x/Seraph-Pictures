{
  'use strict';
  function isPlainFileId(value) {
    if (!value) return false;
    return !value.includes('/') && !value.includes('://');
  }

  function normalizedFileUrl(baseURL, item) {
    const rawUrl = item.url || item.path || '';
    const absoluteMatch = rawUrl.startsWith('https://') ? rawUrl.match(/\/file\/([^?#]+)/) : null;
    if (absoluteMatch) return `${baseURL}/file/${absoluteMatch[1]}`;
    if (rawUrl.startsWith('/file/')) return `${baseURL}${rawUrl}`;
    if (isPlainFileId(rawUrl)) return `${baseURL}/file/${rawUrl}`;
    const lastSegment = rawUrl.split('/').pop().split('?')[0];
    if (lastSegment?.includes('.')) return `${baseURL}/file/${lastSegment}`;
    return rawUrl;
  }

  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
previewImage(url) {
            this.previewData = {
              type: "native-image",
              url: url,
            };
          },
previewDescriptor(options) {
            const groups = {
              'native-image': ['jpg','jpeg','png','gif','webp','bmp','svg','ico'],
              video: ['mp4','webm','mkv','avi','mov','m3u8'],
              audio: ['mp3','wav','ogg','flac','m4a','aac'],
              text: ['txt','md','markdown','json','xml','html','htm','css','js','ts','csv','log','yaml','yml','ini','conf','cfg'],
              office: ['doc','docx','xls','xlsx','ppt','pptx'],
            };
            const base = { url: options.url, fileName: options.fileName };
            if (groups['native-image'].includes(options.extension)) return { ...base, type: 'native-image' };
            if (groups.video.includes(options.extension)) return { ...base, type: 'video' };
            if (groups.audio.includes(options.extension)) return { ...base, type: 'audio' };
            if (options.extension === 'pdf') return { ...base, type: 'iframe', iframeUrl: options.url };
            if (groups.text.includes(options.extension)) {
              return { ...base, type: 'iframe', iframeUrl: options.url, sandbox: '' };
            }
            if (!groups.office.includes(options.extension)) return null;
            const source = encodeURIComponent(options.url);
            return { ...base, type: 'iframe', iframeUrl: `https://view.officeapps.live.com/op/embed.aspx?src=${source}` };
          },
openPreview(file) {
            const fileName = this.getDisplayName(file);
            const url = this.getCleanFileUrl(file);
            const extension = fileName.split('.').pop().toLowerCase();
            const descriptor = this.previewDescriptor({ fileName, url, extension });
            if (descriptor) { this.previewData = descriptor; return; }
            this.downloadFile(file);
          },
closePreview() {
            if (document.fullscreenElement || document.webkitFullscreenElement) {
              (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            }
            // 彻底移除 iframe 元素，停止视频/音频播放
            if (this.$refs.previewIframe) {
              this.$refs.previewIframe.src = "about:blank";
            }
            this.previewData = null;
          },
togglePreviewFullscreen() {
            const el = this.$refs.previewModal;
            const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
            if (fsEl) {
              (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else if (el) {
              (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
            }
          },
handlePreviewFullscreenChange() {
            this.isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
          },
copyPreviewLink() {
            if (!this.previewData) return;
            const link = this.previewData.url;
            const fallback = () => {
              const textarea = document.createElement("textarea");
              textarea.value = link;
              textarea.style.position = "fixed";
              textarea.style.opacity = "0";
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand("copy");
              document.body.removeChild(textarea);
              this.showToast(this.t('home.toastDirectCopied'), "success");
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard
                .writeText(link)
                .then(() => this.showToast(this.t('home.toastDirectCopied'), "success"))
                .catch(() => fallback());
            } else {
              fallback();
            }
          },
downloadPreviewFile() {
            if (!this.previewData) return;
            const a = document.createElement("a");
            a.href = this.previewData.url;
            a.download = this.previewData.fileName || "download";
            a.click();
          },
addToHistory(file) {
            // 避免重复
            const exists = this.uploadHistory.find((h) => h.url === file.url);
            if (!exists) {
              this.uploadHistory.unshift({ ...file, selected: false });
              this.saveHistory();
            }
          },
selectAllHistory() {
            const newState = !this.isAllHistorySelected;
            this.uploadHistory.forEach((f) => (f.selected = newState));
          },
toggleHistorySelect(index) {
            this.uploadHistory[index].selected =
              !this.uploadHistory[index].selected;
          },
copySelectedHistoryLinks() {
            const links = this.uploadHistory
              .filter((f) => f.selected)
              .map((f) => this.formatLink(f))
              .join("\n");
            this.copyToClipboard(links);
            this.showToast(
              this.t('home.toastCopiedN', { count: this.selectedHistoryCount }),
              "success",
            );
          },
removeFromHistory(index) {
            this.uploadHistory.splice(index, 1);
            this.saveHistory();
          },
getDisplayName(item) {
            // 优先使用 fileName 或 name
            const name = item.fileName || item.name;

            // 如果有有效的名称（不包含 :// 协议头）
            if (name && !name.includes("://")) {
              return name;
            }

            // 尝试从 URL 提取文件名部分
            if (item.url) {
              const urlPath = item.url.split("/").pop().split("?")[0];
              // 只有当提取的文件名合理时才使用（有扩展名且长度适中）
              if (urlPath && urlPath.includes(".") && urlPath.length < 80) {
                return urlPath;
              }
            }

            return this.t('home.unknownFile');
          },
getCleanFileUrl(item) {
            return normalizedFileUrl(this.baseURL, item);
          },
getCleanFilePath(item) {
            const fullUrl = this.getCleanFileUrl(item);
            try {
              const url = new URL(fullUrl);
              return url.pathname;
            } catch {
              // 如果解析失败，尝试直接提取
              const match = fullUrl.match(/(\/file\/[^?#]+)/);
              return match ? match[1] : fullUrl;
            }
          },
isImageFile(filename) {
            if (!filename) return false;
            const ext = this.getFileExt(filename).toLowerCase();
            return [
              "jpg",
              "jpeg",
              "png",
              "gif",
              "webp",
              "bmp",
              "svg",
              "ico",
            ].includes(ext);
          },
getFileExt(filename) {
            if (!filename) return "";
            const parts = filename.split(".");
            return parts.length > 1 ? parts.pop() : "";
          }
  }});
}
