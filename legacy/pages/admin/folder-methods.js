{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
observeMobileNavHeight() {
        if (typeof ResizeObserver !== 'function') return;
        this.unobserveMobileNavHeight();

        const header = (this.$el && this.$el.querySelector('.header-content')) || document.querySelector('.header-content');
        if (!header) return;

        this.headerResizeObserver = new ResizeObserver(() => {
          this.queueMobileNavMetricsUpdate();
        });
        this.headerResizeObserver.observe(header);
      },
unobserveMobileNavHeight() {
        if (this.headerResizeObserver && typeof this.headerResizeObserver.disconnect === 'function') {
          this.headerResizeObserver.disconnect();
        }
        this.headerResizeObserver = null;
      },
updateViewportFlags() {
        this.isMobileViewport = window.matchMedia('(max-width: 900px)').matches;
        if (this.isMobileViewport) {
          this.batchToolbarPosition.left = null;
          this.batchToolbarPosition.top = null;
          this.batchDragState.dragging = false;
        }
        this.queueMobileNavMetricsUpdate();
      },
restoreFolderCache() {
        try {
          const raw = localStorage.getItem('adminFolderListCache');
          const parsed = raw ? JSON.parse(raw) : {};
          this.folderListCache = parsed && typeof parsed === 'object' ? parsed : {};
          this.pruneFolderCache();
        } catch {
          this.folderListCache = {};
        }
      },
persistFolderCache() {
        try {
          localStorage.setItem('adminFolderListCache', JSON.stringify(this.folderListCache));
        } catch {
          // ignore storage quota errors
        }
      },
pruneFolderCache() {
        const now = Date.now();
        const entries = Object.entries(this.folderListCache || {})
          .filter(([, value]) => value && Number.isFinite(Number(value.time)) && (now - Number(value.time) <= this.folderCacheTTL))
          .sort((a, b) => Number(b[1].time || 0) - Number(a[1].time || 0))
          .slice(0, this.folderCacheMaxEntries);
        this.folderListCache = Object.fromEntries(entries);
      },
getFolderCacheKey() {
        const folder = this.normalizeFolderPath(this.folderPath || '');
        const storage = this.storageProfileId || String(this.storageFilter || 'all').toLowerCase();
        return `${storage}::${folder}`;
      },
cloneRowsForCache(rows = []) {
        return rows.map((item) => ({
          ...item,
          selected: false,
          metadata: { ...(item.metadata || {}) },
        }));
      },
readFolderCache(cacheKey) {
        const entry = this.folderListCache?.[cacheKey];
        if (!entry) return null;
        if (!Number.isFinite(Number(entry.time)) || (Date.now() - Number(entry.time) > this.folderCacheTTL)) {
          delete this.folderListCache[cacheKey];
          this.persistFolderCache();
          return null;
        }
        return entry;
      },
applyFolderCacheEntry(entry) {
        if (!entry) return;
        this.tableData = this.cloneRowsForCache(entry.rows || []);
        this.nextCursor = entry.nextCursor || null;
        this.totalCount = Number.isFinite(entry.totalCount) ? Number(entry.totalCount) : this.tableData.length;
        this.updateStats();
        this.calculatePageSize();
        this.sortData(this.tableData);
        this.normalizeCurrentPage();
      },
writeFolderCache(cacheKey) {
        if (!cacheKey) return;
        this.folderListCache[cacheKey] = {
          time: Date.now(),
          rows: this.cloneRowsForCache(this.tableData),
          nextCursor: this.nextCursor,
          totalCount: this.totalCount,
        };
        this.pruneFolderCache();
        this.persistFolderCache();
      },
clearFolderCache() {
        this.folderListCache = {};
        try {
          localStorage.removeItem('adminFolderListCache');
        } catch {
          // ignore
        }
      },
getStorageType(name = '') {
        if (String(name).startsWith('r2:')) return 'r2';
        if (String(name).startsWith('s3:')) return 's3';
        if (String(name).startsWith('discord:')) return 'discord';
        if (String(name).startsWith('hf:')) return 'huggingface';
        if (String(name).startsWith('webdav:')) return 'webdav';
        if (String(name).startsWith('github:')) return 'github';
        return 'telegram';
      },
getStorageLabel(name = '') {
        const type = this.getStorageType(name);
        const map = {
          telegram: 'Telegram',
          r2: 'R2',
          s3: 'S3',
          discord: 'Discord',
          huggingface: 'HuggingFace',
          webdav: 'WebDAV',
          github: 'GitHub',
        };
        return map[type] || 'Telegram';
      },
toggleSelectByName(name) {
        const target = this.tableData.find((item) => item.name === name);
        if (target) target.selected = !target.selected;
      },
switchViewMode(mode) {
        if (!['grid', 'list'].includes(mode)) return;
        this.viewMode = mode;
      },
cloneFoldersSnapshot() {
        return Array.isArray(this.folders) ? this.folders.map((item) => ({ ...item })) : [];
      },
sortFoldersLocal() {
        this.folders = [...(this.folders || [])].sort((a, b) => {
          const pathA = this.normalizeFolderPath(a.path || a.folderPath || '');
          const pathB = this.normalizeFolderPath(b.path || b.folderPath || '');
          const depthA = Number.isFinite(a.depth) ? a.depth : (pathA ? pathA.split('/').length : 0);
          const depthB = Number.isFinite(b.depth) ? b.depth : (pathB ? pathB.split('/').length : 0);
          if (depthA !== depthB) return depthA - depthB;
          return pathA.localeCompare(pathB, 'zh-CN', { sensitivity: 'base' });
        });
      },
buildFolderNode(path, fileCount = 0) {
        const normalized = this.normalizeFolderPath(path);
        if (!normalized) return null;
        const segments = normalized.split('/');
        return {
          path: normalized,
          name: segments[segments.length - 1] || normalized,
          parentPath: segments.length > 1 ? segments.slice(0, -1).join('/') : '',
          depth: segments.length,
          fileCount: Number(fileCount || 0),
        };
      },
ensureFolderBranchLocal(path) {
        const normalized = this.normalizeFolderPath(path);
        if (!normalized) return;
        const parts = normalized.split('/');
        let current = '';
        parts.forEach((part) => {
          current = current ? `${current}/${part}` : part;
          const exists = (this.folders || []).some((folder) => {
            return this.normalizeFolderPath(folder.path || folder.folderPath || '') === current;
          });
          if (!exists) {
            const node = this.buildFolderNode(current, 0);
            if (node) this.folders.push(node);
          }
        });
        this.sortFoldersLocal();
      },
renameFolderBranchLocal(sourcePath, targetPath) {
        const source = this.normalizeFolderPath(sourcePath);
        const target = this.normalizeFolderPath(targetPath);
        if (!source || !target || source === target) return;
        this.folders = (this.folders || []).map((folder) => {
          const current = this.normalizeFolderPath(folder.path || folder.folderPath || '');
          if (!current || (current !== source && !current.startsWith(`${source}/`))) {
            return folder;
          }
          const suffix = current === source ? '' : current.slice(source.length + 1);
          const nextPath = suffix ? `${target}/${suffix}` : target;
          const nextNode = this.buildFolderNode(nextPath, Number(folder.fileCount || 0));
          return nextNode ? { ...folder, ...nextNode } : folder;
        });
        this.sortFoldersLocal();
      },
removeFolderBranchLocal(path) {
        const target = this.normalizeFolderPath(path);
        if (!target) return;
        this.folders = (this.folders || []).filter((folder) => {
          const current = this.normalizeFolderPath(folder.path || folder.folderPath || '');
          return current !== target && !current.startsWith(`${target}/`);
        });
        this.sortFoldersLocal();
      },
async selectFolder(path = '') {
        const normalized = this.normalizeFolderPath(path);
        if (normalized === this.folderPath && this.tableData.length > 0) return;
        this.folderPath = normalized;
        this.currentPage = 1;
        await this.refreshFileList({ preferCache: true });
      },
async fetchFolders() {
        this.folderLoading = true;
        try {
          const params = new URLSearchParams();
          if (this.storageFilter && this.storageFilter !== 'all') {
            params.set('storage', this.storageFilter);
          }
          if (this.storageProfileId) params.set('storageId', this.storageProfileId);
          const query = params.toString();
          const response = await fetch(`/api/manage/folders${query ? `?${query}` : ''}`, { method: 'GET', credentials: 'include' });
          const data = await response.json();
          this.folders = Array.isArray(data?.folders) ? data.folders : [];
        } catch (error) {
          this.folders = [];
          this.$message.error(this.t('admin.folderListLoadFailed'));
        } finally {
          this.folderLoading = false;
        }
      },
async refreshFolderResources(showMessage = true) {
        try {
          this.clearFolderCache();
          await Promise.all([this.fetchFolders(), this.refreshFileList({ force: true })]);
          if (showMessage) {
            this.$message.success(this.t('admin.folderFilesRefreshed'));
          }
        } catch (error) {
          if (showMessage) {
            this.$message.error(error?.message || this.t('admin.refreshFailedRetry'));
          }
        }
      }
  }});
}
