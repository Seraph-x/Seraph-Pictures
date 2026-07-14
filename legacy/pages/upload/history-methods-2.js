{
  'use strict';
  function validHistoryName(value) {
    return Boolean(value) && !value.includes('://');
  }

  function inferredHistoryName(url) {
    const name = String(url || '').split('/').pop().split('?')[0];
    if (!name) return '';
    if (!name.includes('.')) return '';
    return name.length < 80 ? name : '';
  }

  function pollutedFileUrl(baseURL, url) {
    if (!/\/file\/https?:\/\//.test(url)) return '';
    const match = url.match(/\/file\/([^\/?#]+\.[a-zA-Z0-9]+)(?:[?#].*)?$/);
    return match ? `${baseURL}/file/${match[1]}` : '';
  }

  function duplicatedFileUrl(baseURL, url) {
    if (!/https?:\/\/.*https?:\/\//.test(url)) return '';
    const match = url.match(/(https?:\/\/[^/]+\/file\/[^?#]+)/);
    if (!match) return '';
    return `${baseURL}/file/${match[1].split('/file/').pop()}`;
  }

  function absoluteFileUrl(baseURL, url) {
    if (!url.startsWith('https://')) return '';
    const match = url.match(/\/file\/([^?#]+)/);
    return match ? `${baseURL}/file/${match[1]}` : '';
  }

  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
getFileIcon(filename) {
            const ext = this.getFileExt(filename).toLowerCase();
            const iconMap = {
              // 视频
              mp4: "fas fa-video",
              webm: "fas fa-video",
              avi: "fas fa-video",
              mov: "fas fa-video",
              mkv: "fas fa-video",
              flv: "fas fa-video",
              // 音频
              mp3: "fas fa-music",
              wav: "fas fa-music",
              ogg: "fas fa-music",
              flac: "fas fa-music",
              aac: "fas fa-music",
              m4a: "fas fa-music",
              // 文档
              pdf: "fas fa-file-pdf",
              doc: "fas fa-file-word",
              docx: "fas fa-file-word",
              xls: "fas fa-file-excel",
              xlsx: "fas fa-file-excel",
              ppt: "fas fa-file-powerpoint",
              pptx: "fas fa-file-powerpoint",
              txt: "fas fa-file-alt",
              md: "fas fa-file-alt",
              // 压缩包
              zip: "fas fa-file-archive",
              rar: "fas fa-file-archive",
              "7z": "fas fa-file-archive",
              tar: "fas fa-file-archive",
              gz: "fas fa-file-archive",
              // 代码
              js: "fas fa-file-code",
              ts: "fas fa-file-code",
              py: "fas fa-file-code",
              java: "fas fa-file-code",
              c: "fas fa-file-code",
              cpp: "fas fa-file-code",
              html: "fas fa-file-code",
              css: "fas fa-file-code",
              json: "fas fa-file-code",
            };
            return iconMap[ext] || "fas fa-file";
          },
getFileIconClass(filename) {
            const ext = this.getFileExt(filename).toLowerCase();
            const videoExts = ["mp4", "webm", "avi", "mov", "mkv", "flv"];
            const audioExts = ["mp3", "wav", "ogg", "flac", "aac", "m4a"];
            const docExts = [
              "pdf",
              "doc",
              "docx",
              "xls",
              "xlsx",
              "ppt",
              "pptx",
              "txt",
              "md",
            ];
            const archiveExts = ["zip", "rar", "7z", "tar", "gz"];
            const codeExts = [
              "js",
              "ts",
              "py",
              "java",
              "c",
              "cpp",
              "html",
              "css",
              "json",
            ];

            if (videoExts.includes(ext)) return "video-file";
            if (audioExts.includes(ext)) return "audio-file";
            if (docExts.includes(ext)) return "document-file";
            if (archiveExts.includes(ext)) return "archive-file";
            if (codeExts.includes(ext)) return "code-file";
            return "other-file";
          },
handleHistoryImgError(event, item) {
            // 图片加载失败时，将其标记为非图片，让Vue重新渲染为图标
            item._imgError = true;
            this.$forceUpdate();
          },
clearHistory() {
            this.$confirm(this.t('home.confirmClearHistory'), this.t('home.tip'), {
              type: "warning",
              confirmButtonText: this.t('home.confirmBtn'),
              cancelButtonText: this.t('home.cancel'),
            })
              .then(() => {
                this.uploadHistory = [];
                this.saveHistory();
                this.showToast(this.t('home.toastHistoryCleared'), "success");
              })
              .catch((error) => {
                if (error !== 'cancel' && error !== 'close') throw error;
              });
          },
saveHistory() {
            localStorage.setItem(
              "uploadHistory",
              JSON.stringify(this.uploadHistory),
            );
          },
migrateHistoryItem(historyItem) {
            const item = { ...historyItem, selected: false };
            let changed = false;
            if (item.url) {
              const cleanUrl = this.cleanUrlField(item.url);
              if (cleanUrl !== item.url) { item.url = cleanUrl; changed = true; }
            }
            if (validHistoryName(item.fileName)) return { item, changed };
            if (validHistoryName(item.name)) {
              item.fileName = item.name;
              return { item, changed: true };
            }
            const urlName = inferredHistoryName(item.url);
            item.fileName = urlName || this.t('home.unknownFile');
            item.name = item.fileName;
            return { item, changed: true };
          },
loadHistory() {
            const raw = localStorage.getItem('uploadHistory');
            if (!raw) return;
            let parsed;
            try { parsed = JSON.parse(raw); }
            catch (cause) { throw Object.assign(new Error('UPLOAD_HISTORY_INVALID'), { cause }); }
            if (!Array.isArray(parsed)) throw new Error('UPLOAD_HISTORY_INVALID');
            const migrated = parsed.map((item) => this.migrateHistoryItem(item));
            this.uploadHistory = migrated.map((entry) => entry.item);
            if (migrated.some((entry) => entry.changed)) this.saveHistory();
          },
cleanUrlField(url) {
            if (!url) return url;
            return pollutedFileUrl(this.baseURL, url)
              || duplicatedFileUrl(this.baseURL, url)
              || absoluteFileUrl(this.baseURL, url)
              || (url.startsWith('/file/') ? `${this.baseURL}${url}` : url);
          },
formatSize(bytes) {
            if (!bytes) return "0 B";
            const units = ["B", "KB", "MB", "GB"];
            let i = 0;
            while (bytes >= 1024 && i < units.length - 1) {
              bytes /= 1024;
              i++;
            }
            return bytes.toFixed(i > 0 ? 2 : 0) + " " + units[i];
          },
getStatusText(status) {
            const texts = {
              waiting: this.t('home.statusWaiting'),
              processing: this.t('home.statusProcessing'),
              uploading: this.t('home.statusUploading'),
              success: this.t('home.statusSuccess'),
              error: this.t('home.statusError'),
            };
            return texts[status] || status;
          },
getFileIcon(filename) {
            const ext = filename.split(".").pop().toLowerCase();
            const iconMap = {
              pdf: "fas fa-file-pdf",
              "doc,docx": "fas fa-file-word",
              "xls,xlsx,csv": "fas fa-file-excel",
              "ppt,pptx": "fas fa-file-powerpoint",
              "txt,md,log": "fas fa-file-lines",
              "mp4,webm,avi,mov,wmv,flv,mkv,m4v,3gp,ts": "fas fa-file-video",
              "mp3,wav,ogg,flac,aac,m4a,wma,ape,opus": "fas fa-file-audio",
              "zip,rar,7z,tar,gz,bz2": "fas fa-file-zipper",
              "exe,msi,dmg,deb,rpm": "fas fa-file-arrow-down",
              apk: "fab fa-android",
              "iso,img": "fas fa-compact-disc",
              "json,xml,yaml,yml,toml": "fas fa-file-code",
              "html,htm,css,js,ts,jsx,tsx,vue,php,py,java,c,cpp,h,hpp,cs,go,rs,rb,pl,sh,sql":
                "fas fa-file-code",
              "jpg,jpeg,png,gif,webp,bmp,svg,ico,heic,heif,avif":
                "fas fa-file-image",
              "psd,ai,eps,cdr": "fas fa-file-image",
            };
            for (const [exts, icon] of Object.entries(iconMap)) {
              if (exts.split(",").includes(ext)) return icon;
            }
            return "fas fa-file";
          }
  }});
}
