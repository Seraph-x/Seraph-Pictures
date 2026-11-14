{
  'use strict';
  const UPLOAD_INITIAL_STATE = {
          baseURL: document.location.origin,
          lang: (window.I18n && I18n.getLang()) || 'zh',
          isDragging: false,
          showUrlInput: false,
          urlToUpload: "",
          urlUploading: false,
          pendingUploadBatch: null,
          pendingCompressionChoice: "original",
          imageUploadDecision: "original",
          imageCompress: {
            enabled: false,
            format: "webp",
            quality: 82,
            maxDimension: 0,
            keepOriginalWhenLarger: true,
            support: {
              webp: true,
              avif: true,
              jpeg: true,
              png: true,
            },
          },
          uploadingFiles: [],
          uploadedFiles: [],
          uploadHistory: [],
          linkFormat: "url",
          resultViewMode: "list", // 结果区视图：list（列表）/ grid（网格）
          uploadSortDesc: true, // 按上传顺序排序：true=最新在前（默认），false=最早在前
          previewData: null, // 新的预览数据对象
          isFullscreen: false, // 预览是否处于全屏
          toasts: [],
          isAuthenticated: false,
          folderPath: "",
          storageMode: "telegram", // 存储模式：telegram, r2, s3, discord, huggingface, github
          storageTarget: (window.I18n ? I18n.t('home.tgChannel') : "Telegram 频道"), // 显示文本
          r2Available: false, // R2 是否可用
          s3Available: false, // S3 是否可用
          discordAvailable: false, // Discord 是否可用
          huggingfaceAvailable: false,
          githubAvailable: false,
          authChecking: true, // 是否正在检查认证状态
          isGuest: false, // 是否为访客模式
          guestUploadConfig: null, // 访客上传配置 { maxFileSize, maxDailyUploads }
          uploadConfig: {
            maxSize: 100 * 1024 * 1024, // 100MB max (chunked upload)
            chunkSize: 5 * 1024 * 1024, // 5MB chunks
            smallFileThreshold: 20 * 1024 * 1024, // 20MB, below this use direct upload
            maxConcurrent: 3,
          },
          uploadLimits: {},
        };
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({
data() {
    return JSON.parse(JSON.stringify(UPLOAD_INITIAL_STATE));
  },
computed: {
          selectedCount() {
            return this.uploadedFiles.filter((f) => f.selected).length;
          },
          isAllSelected() {
            return (
              this.uploadedFiles.length > 0 &&
              this.uploadedFiles.every((f) => f.selected)
            );
          },
          displayedFiles() {
            // uploadedFiles 本身是「最新在前」（新文件 unshift 到头部）
            return this.uploadSortDesc
              ? this.uploadedFiles
              : this.uploadedFiles.slice().reverse();
          },
          failedCount() {
            return this.uploadingFiles.filter((f) => f.status === "error")
              .length;
          },
          imageCompressFormats() {
            void this.lang;
            return [
              {
                value: "webp",
                label: "WebP",
                mime: "image/webp",
                ext: "webp",
                icon: "fas fa-image",
                tip: this.t('home.tipWebp'),
              },
              {
                value: "avif",
                label: "AVIF",
                mime: "image/avif",
                ext: "avif",
                icon: "fas fa-bolt",
                tip: this.t('home.tipAvif'),
              },
              {
                value: "jpeg",
                label: "JPEG",
                mime: "image/jpeg",
                ext: "jpg",
                icon: "fas fa-file-image",
                tip: this.t('home.tipJpeg'),
              },
              {
                value: "png",
                label: "PNG",
                mime: "image/png",
                ext: "png",
                icon: "far fa-file-image",
                tip: this.t('home.tipPng'),
              },
            ];
          },
          imageCompressSummary() {
            const format =
              this.imageCompressFormats.find(
                (item) => item.value === this.imageCompress.format,
              ) || this.imageCompressFormats[0];
            const sizeText = this.imageCompress.maxDimension
              ? this.t('home.sizeMaxDim', { px: this.imageCompress.maxDimension })
              : this.t('home.sizeKeepOriginal');
            const modeText =
              this.imageUploadDecision === "optimized"
                ? `Optimized images use ${format.label}, quality ${this.imageCompress.quality}%, ${sizeText}.`
                : this.imageUploadDecision === "ask"
                  ? this.imageCompress.enabled
                    ? `Ask dialog defaults to ${format.label}, quality ${this.imageCompress.quality}%, ${sizeText}.`
                    : "Ask dialog defaults to Original."
                  : "Original image files upload directly by default.";
            return modeText;
          },
          imageUploadDecisionSummary() {
            const messages = {
              original: "Default: upload original image files directly without a confirmation dialog.",
              optimized: "Images are converted with the settings below before upload.",
              ask: "Ask before each image batch and remember this behavior choice.",
            };
            return messages[this.imageUploadDecision] || messages.original;
          },
          currentUploadLimitLabel() {
            const limit = this.getUploadLimit(this.storageMode);
            return this.formatSize(limit.maxBytes || this.uploadConfig.maxSize);
          },
          pendingUploadStats() {
            const files = this.pendingUploadBatch?.files || [];
            return files.reduce(
              (stats, file) => {
                stats.fileCount += 1;
                stats.totalSize += file.size || 0;
                if (this.isCompressibleImage(file)) stats.imageCount += 1;
                return stats;
              },
              { fileCount: 0, imageCount: 0, totalSize: 0 },
            );
          },
          selectedHistoryCount() {
            return this.uploadHistory.filter((f) => f.selected).length;
          },
          isAllHistorySelected() {
            return (
              this.uploadHistory.length > 0 &&
              this.uploadHistory.every((f) => f.selected)
            );
          },
          historyStats() {
            const stats = { images: 0, videos: 0, others: 0, totalSize: 0 };
            this.uploadHistory.forEach((item) => {
              const ext = item.name.split(".").pop().toLowerCase();
              if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
                stats.images++;
              } else if (["mp4", "webm", "avi", "mov"].includes(ext)) {
                stats.videos++;
              } else {
                stats.others++;
              }
              stats.totalSize += item.size || 0;
            });
            return stats;
          },
        }
  });
}
