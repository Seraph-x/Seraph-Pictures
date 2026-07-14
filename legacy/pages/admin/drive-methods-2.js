{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
buildListQueryParams({ cursor = null, limit = null, includeStats = true } = {}) {
        const params = new URLSearchParams();
        if (cursor !== null && cursor !== undefined && cursor !== '') {
          params.set('cursor', String(cursor));
        }
        params.set('limit', String(limit ?? this.getListRequestLimit(false)));
        if (includeStats) {
          params.set('includeStats', '1');
        }
        // 首屏优先取小文件，先让可见内容更快完成渲染
        params.set('sort', 'sizeAsc');
        params.set('path', this.folderPath || '');
        if (this.storageFilter && this.storageFilter !== 'all') {
          params.set('storage', this.storageFilter);
        }
        if (this.storageProfileId) {
          params.set('storageId', this.storageProfileId);
        }
        return params;
      },
sort(command) { this.sortOption = command; },
filter(command) { this.filterOption = command; },
async switchStorageFilter(command) {
        this.storageFilter = command;
        this.storageProfileId = '';
        this.currentPage = 1;
        await this.refreshFileList({ syncFolders: true });
      },
applyLoadedPage(result) {
        const mapped = (result.files || []).map((file) => this.normalizeListItem(file));
        this.mergeListData(mapped);
        this.nextCursor = result.list_complete ? null : result.cursor;
        if (Number.isFinite(result?.stats?.total)) this.totalCount = result.stats.total;
        this.updateStats();
        this.writeFolderCache(this.getFolderCacheKey());
        this.normalizeCurrentPage();
      },
notifyLoadedPage(options) {
        if (options.silent) return;
        if (this.nextCursor) {
          this.$message.success(`已补充 ${options.loaded} 条数据，可继续翻页`);
          return;
        }
        if (!options.auto) this.$message.success(`已加载剩余 ${options.loaded} 条`);
      },
async loadMore(options = {}) {
        const { silent = false, auto = false } = options;
        if (this.isLoadingMore || !this.nextCursor) return;
        this.isLoadingMore = true;
        const startCount = this.tableData.length;
        try {
          const params = this.buildListQueryParams({
            cursor: this.nextCursor,
            limit: this.getListRequestLimit(true),
            includeStats: true,
          });
          const result = await fetch(`/api/drive/explorer?${params.toString()}`, {
            method: 'GET',
            credentials: 'include',
          }).then((r) => r.json());
          if (result.success !== true) throw new Error(result.error?.code || 'DRIVE_LIST_FAILED');
          this.applyLoadedPage(result);
          const loaded = Math.max(0, this.tableData.length - startCount);
          this.notifyLoadedPage({ silent, auto, loaded });
        } catch (error) {
          if (!silent) this.$message.error('加载更多失败，请稍后重试');
          throw error;
        } finally {
          this.isLoadingMore = false;
        }
      },
sortData(data) {
          return this.sortOption === 'nameAsc' ? data.sort((a, b) => a.name.localeCompare(b.name)) :
            this.sortOption === 'sizeDesc' ? data.sort((a, b) => b.metadata.fileSize - a.metadata.fileSize) :
            data.sort((a, b) => b.metadata.TimeStamp - a.metadata.TimeStamp);
      },
formattedFileDetails(item) {
        const metadata = item.metadata;
        const timestamp = new Date(metadata.TimeStamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const storageType = this.getStorageType(item.name);
        const storageLabel = this.getProfileLabel(item);
        const storageColor = this.getStorageColor(storageType);
        const fileSize = metadata.fileSize ? this.formatFileSize(metadata.fileSize) : '未知';
        const folderPath = this.normalizeFolderPath(metadata.folderPath || '');
        return `
          <div style="text-align: left; padding: 5px;">
            <div><strong>ID：</strong>${item.name}</div>
            <div><strong>文件名：</strong>${metadata.fileName || item.name}</div>
            <div><strong>文件大小：</strong>${fileSize}</div>
            <div><strong>存储位置：</strong><span style="color: ${storageColor}; font-weight: bold;">${storageLabel}</span></div>
            <div><strong>所在目录：</strong>${folderPath || '根目录'}</div>
            <div><strong>上传时间：</strong>${timestamp}</div>
            <div><strong>状态：</strong>${metadata.ListType || 'None'}</div>
          </div>
        `;
      },
getStorageColor(storageType) {
        const colors = {
          r2: '#409eff', s3: '#e6a23c', discord: '#7289da',
          huggingface: '#ff9d00', webdav: '#8f65ff', github: '#24292f',
        };
        return colors[storageType] || '#67c23a';
      },
formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      },
calculatePageSize() {  // 设置页面大小
        const config = {
          desktopMinSize: 20,
          desktopMaxSize: 25,
          mobileMinSize: 10,
          mobileMaxSize: 14,
          cardWidth: 240,
          ratio: 3/4, // 卡片高宽比
          gap: 20, // 卡片间距
          defaultWidth: 800,
          defaultHeaderHeight: 60 // 默认Dashboard高度
        };
        // 获取容器尺寸
        const content = document.querySelector('.content');
        const header = document.querySelector('.header-content');
        const width = content?.clientWidth || config.defaultWidth;
        const height = window.innerHeight - (header?.offsetHeight || config.defaultHeaderHeight);
        // 计算行列数
        const cols = Math.max(1, Math.floor(width / (config.cardWidth + config.gap)));
        const cardHeight = Math.max(120, (width / cols - config.gap) * config.ratio);
        const rows = Math.max(1, Math.floor(height / (cardHeight + config.gap)));
        const estimated = rows * cols;
        if (this.isMobileViewport) {
          this.pageSize = Math.max(config.mobileMinSize, Math.min(config.mobileMaxSize, estimated));
        } else {
          this.pageSize = Math.max(config.desktopMinSize, Math.min(config.desktopMaxSize, estimated));
        }
      },
updateWindowWidth() {  // 动态调整页面大小
        this.windowWidth = window.innerWidth;
        this.calculatePageSize();
      },
normalizeCurrentPage() {
        const totalPages = Math.max(1, Math.ceil((this.paginationTotal || 0) / this.pageSize));
        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;
      },
handleWindowResize() {
        this.updateViewportFlags();
        this.updateWindowWidth();
        this.normalizeCurrentPage();
        if (this.selectedFiles.length > 0 && !this.isMobileViewport) {
          this.$nextTick(() => this.snapBatchToolbarToBottom());
        }
      },
updateStats() {
        this.Number = this.tableData.length;
        if (!Number.isFinite(this.totalCount) || this.totalCount < this.Number) {
          this.totalCount = this.Number;
        }
        let fileCount = {image: 0, video: 0, audio: 0, document: 0};
        this.tableData.forEach(file => {
          const ext = file.name.split('.').pop().toLowerCase();
          const type = Object.keys(this.fileConfig).find(t =>
            this.fileConfig[t].exts.includes(ext)
          ) || 'document';
          fileCount[type]++;
        });
        ['image', 'video', 'audio', 'document'].forEach((type) => {
          this.fileConfig[type].count = fileCount[type] || 0;
        });
      }
  }});
}
