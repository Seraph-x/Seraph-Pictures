{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
goHome() { window.location.href = '/'; },
refreshDashboard() { location.reload(); },
clearSelection() {  // 取消全部选择
        this.tableData.forEach(file => file.selected = false);
      },
startBatchDrag(event) {
        if (this.isMobileViewport) return;
        if (event.button !== 0) return;
        const toolbar = this.$refs.batchToolbar;
        if (!toolbar) return;
        const rect = toolbar.getBoundingClientRect();
        this.batchDragState.dragging = true;
        this.batchDragState.offsetX = event.clientX - rect.left;
        this.batchDragState.offsetY = event.clientY - rect.top;
        this.batchToolbarPosition.left = rect.left;
        this.batchToolbarPosition.top = rect.top;
        document.addEventListener('mousemove', this.onBatchDrag);
        document.addEventListener('mouseup', this.stopBatchDrag);
      },
onBatchDrag(event) {
        if (!this.batchDragState.dragging) return;
        const toolbar = this.$refs.batchToolbar;
        if (!toolbar) return;
        const width = toolbar.offsetWidth;
        const height = toolbar.offsetHeight;
        const padding = 12;
        let left = event.clientX - this.batchDragState.offsetX;
        let top = event.clientY - this.batchDragState.offsetY;
        left = Math.max(padding, Math.min(left, window.innerWidth - width - padding));
        top = Math.max(padding, Math.min(top, window.innerHeight - height - padding));
        this.batchToolbarPosition.left = left;
        this.batchToolbarPosition.top = top;
      },
stopBatchDrag() {
        if (this.isMobileViewport) return;
        if (!this.batchDragState.dragging) return;
        this.batchDragState.dragging = false;
        document.removeEventListener('mousemove', this.onBatchDrag);
        document.removeEventListener('mouseup', this.stopBatchDrag);
        this.snapBatchToolbarToBottom();
      },
snapBatchToolbarToBottom() {
        if (this.isMobileViewport) {
          this.batchToolbarPosition.left = null;
          this.batchToolbarPosition.top = null;
          return;
        }
        const toolbar = this.$refs.batchToolbar;
        if (!toolbar) return;
        const padding = 12;
        const bottomOffset = 88;
        const width = toolbar.offsetWidth;
        const height = toolbar.offsetHeight;
        let left = this.batchToolbarPosition.left ?? (window.innerWidth - width) / 2;
        left = Math.max(padding, Math.min(left, window.innerWidth - width - padding));
        this.batchToolbarPosition.left = left;
        this.batchToolbarPosition.top = window.innerHeight - height - bottomOffset;
      },
handleGlobalKeydown(event) {
        if (this.selectedFiles.length === 0) return;
        const target = event.target;
        const inputTags = ['INPUT', 'TEXTAREA'];
        const isInput = target ? inputTags.includes(target.tagName) || target.isContentEditable : false;
        if (isInput) return;
        const key = event.key.toLowerCase();
        const modifier = event.ctrlKey || event.metaKey;
        const command = modifier && key === 'c' ? 'handleBatchCopy' : {
          d: 'handleBatchDownload', m: 'moveSelectedToFolder',
          delete: 'handleBatchDelete', backspace: 'handleBatchDelete',
          escape: 'handleEscapeSelection',
        }[key];
        if (!command) return;
        event.preventDefault();
        this[command]();
      },
handleEscapeSelection() {
        if (this.previewData) this.closePreview();
        else this.clearSelection();
      },
getActualFileType(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        if (this.fileConfig.image.exts.includes(ext)) return 'image';
        if (this.fileConfig.video.exts.includes(ext)) return 'video';
        if (this.fileConfig.audio.exts.includes(ext)) return 'audio';
        return 'document';  // 默认归类为文档
      },
openPreview(item) {
        const fileName = item.metadata?.fileName || item.name;
        const fileUrl = `${this.baseURL}/file/${item.name}`;
        const fileType = this.getActualFileType(item.name);
        const ext = item.name.split('.').pop().toLowerCase();
        const base = { url: fileUrl, fileName: fileName, fileKey: item.name };

        // 图片 - 原生图片 Lightbox
        if (fileType === 'image') {
          this.previewData = { ...base, type: 'native-image' };
          return;
        }
        // 视频 - 原生 <video>
        if (fileType === 'video') {
          this.previewData = { ...base, type: 'video' };
          return;
        }
        // 音频 - 原生 <audio>
        if (fileType === 'audio') {
          this.previewData = { ...base, type: 'audio' };
          return;
        }
        // PDF - 浏览器原生查看器
        if (ext === 'pdf') {
          this.previewData = { ...base, type: 'iframe', iframeUrl: fileUrl };
          return;
        }
        // 文本/标记类 - 同源 iframe，sandbox 禁止脚本执行（防止上传的 HTML/SVG 在本站运行）
        const INLINE_TEXT_EXTS = ['txt', 'md', 'markdown', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts', 'csv', 'log', 'yaml', 'yml', 'ini', 'conf', 'cfg', 'svg'];
        if (INLINE_TEXT_EXTS.includes(ext)) {
          this.previewData = { ...base, type: 'iframe', iframeUrl: fileUrl, sandbox: '' };
          return;
        }
        // Office 文档 - 微软 Office Online Viewer（需文件公网可访问）
        const OFFICE_EXTS = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
        if (OFFICE_EXTS.includes(ext)) {
          const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileUrl)}`;
          this.previewData = { ...base, type: 'iframe', iframeUrl: officeUrl };
          return;
        }
        // 其他（压缩包/未知）- 提示下载
        this.previewData = { ...base, type: 'unsupported' };
      },
closePreview() {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
        if (this.$refs.previewIframe) {
          this.$refs.previewIframe.src = 'about:blank';
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
          this.copyToClipboardFallback(link);
          this.$message.success(this.t('admin.directLinkCopied'));
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(link)
            .then(() => this.$message.success(this.t('admin.directLinkCopied')))
            .catch(() => fallback());
        } else {
          fallback();
        }
      },
downloadPreviewFile() {
        if (!this.previewData) return;
        const a = document.createElement('a');
        a.href = this.previewData.url;
        a.download = this.previewData.fileName;
        a.click();
      },
async handleLogout() {  // 退出登录
        try {
          const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
          // 清除本地存储的认证信息
          sessionStorage.clear();
          localStorage.removeItem('storageMode');

          // 尝试清除浏览器缓存的 Basic Auth 凭证
          // 通过发送一个带有错误凭证的请求来清除缓存
          try {
            await fetch('/api/manage/list', {
              method: 'GET',
              headers: { 'Authorization': 'Basic ' + btoa('logout:logout') },
              credentials: 'include'
            });
          } catch (error) { console.warn('Basic auth cache clear failed:', error); }

          this.$message.success(this.t('admin.logoutSuccess'));
          // 跳转到登录页，禁止返回
          setTimeout(() => {
            window.location.replace('/login');
          }, 500);
        } catch (e) {
          this.$message.error(this.t('admin.logoutFailed'));
        }
      },
handlePageChange(page) {
        this.currentPage = page;
        this.normalizeCurrentPage();
      },
normalizeListItem(file) {
        return {
          ...file,
          selected: false,
          metadata: {
            ...file.metadata,
            liked: file.metadata?.liked ?? false,
            fileName: file.metadata?.fileName ?? file.name,
            fileSize: file.metadata?.fileSize ?? 0,
          },
        };
      },
mergeListData(files) {
        const map = new Map(this.tableData.map((item) => [item.name, item]));
        files.forEach((item) => {
          if (!item || !item.name) return;
          const prev = map.get(item.name);
          map.set(item.name, prev ? { ...prev, ...item, selected: prev.selected || item.selected } : item);
        });
        this.tableData = Array.from(map.values());
      },
getListRequestLimit(forLoadMore = false) {
        const basePage = this.isMobileViewport ? 12 : 24;
        return forLoadMore ? basePage * 4 : basePage * 3;
      }
  }});
}
