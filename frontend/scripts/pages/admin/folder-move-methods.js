{
  'use strict';

  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({
    data() {
      return {
        folderMoveDialogVisible: false,
        folderMoveTarget: '',
        folderMovePending: false,
      };
    },
    computed: {
      folderMoveSuggestions() {
        const paths = (this.folders || [])
          .map((folder) => this.normalizeFolderPath(folder.path || folder.folderPath || ''))
          .filter(Boolean);
        const depth = (value) => value.split('/').length;
        const unique = [...new Set(paths)].sort((left, right) => {
          return depth(left) - depth(right) || left.localeCompare(right, 'zh-CN');
        });
        const root = Object.freeze({ value: '', label: this.t('admin.rootDir') });
        const folders = unique.map((value) => Object.freeze({ value, label: value }));
        return Object.freeze([root, ...folders]);
      },
    },
    methods: {
    queryFolderMoveSuggestions(query, callback) {
      const text = String(query || '').trim().toLocaleLowerCase();
      const matches = text ? this.folderMoveSuggestions.filter((item) => {
        return `${item.label} ${item.value}`.toLocaleLowerCase().includes(text);
      }) : this.folderMoveSuggestions;
      callback(matches);
    },
    selectFolderMoveSuggestion(item) {
      this.folderMoveTarget = item.value;
    },
    folderMoveSnapshot() {
      return Object.freeze({
        rows: this.tableData.map((file) => ({ ...file, metadata: { ...(file.metadata || {}) } })),
        folders: this.cloneFoldersSnapshot(),
      });
    },
    hasFolderMove(options) {
      return options.ids.some((id) => {
        const file = this.tableData.find((item) => item.name === id);
        return this.normalizeFolderPath(file?.metadata?.folderPath || '') !== options.targetFolderPath;
      });
    },
    applyFolderMove(options) {
      const ids = new Set(options.ids);
      const current = this.normalizeFolderPath(this.folderPath);
      this.tableData = this.tableData.map((row) => ids.has(row.name) ? {
        ...row, selected: false,
        metadata: { ...(row.metadata || {}), folderPath: options.targetFolderPath },
      } : row).filter((row) => this.normalizeFolderPath(row.metadata?.folderPath || '') === current);
      this.updateStats();
    },
    async requestFolderMove(options) {
      const response = await fetch('/api/drive/files/move', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: options.ids, targetFolderPath: options.targetFolderPath }),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) throw new Error(result.error?.code || 'FILE_MOVE_FAILED');
      return result;
    },
    async performFolderMove(options) {
      if (!this.hasFolderMove(options)) return false;
      const previous = this.folderMoveSnapshot();
      this.applyFolderMove(options);
      try {
        await this.requestFolderMove(options);
        this.clearFolderCache();
        await this.fetchFolders();
        return true;
      } catch (error) {
        this.tableData = previous.rows;
        this.folders = previous.folders;
        this.updateStats();
        throw error;
      }
    },
    resetFolderMoveDialog() {
      this.folderMoveDialogVisible = false;
      this.folderMoveTarget = '';
    },
    promptFolderMove() {
      if (!this.selectedFiles.length) {
        this.$message.warning(this.t('admin.selectFilesFirst'));
        return;
      }
      this.folderMoveTarget = this.normalizeFolderPath(this.folderPath || '');
      this.folderMoveDialogVisible = true;
    },
    closeFolderMoveDialog(done) {
      if (this.folderMovePending) return;
      this.resetFolderMoveDialog();
      if (typeof done === 'function') done();
    },
    async confirmFolderMove() {
      if (this.folderMovePending) return;
      const targetFolderPath = this.normalizeFolderPath(this.folderMoveTarget || '');
      const ids = this.selectedFiles.map((item) => item.name);
      this.folderMovePending = true;
      try {
        const moved = await this.performFolderMove({ ids, targetFolderPath });
        if (!moved) {
          this.$message.info(this.t('admin.filesAlreadyInFolder'));
          this.resetFolderMoveDialog();
          return;
        }
        const folder = targetFolderPath || this.t('admin.rootDir');
        this.$message.success(this.t('admin.movedNToFolder', { n: ids.length, folder }));
        this.resetFolderMoveDialog();
      } catch (error) {
        this.$message.error(error?.message || this.t('admin.moveFilesFailed'));
      } finally {
        this.folderMovePending = false;
      }
    },
    async dropFilesIntoFolder(path, event) {
      const targetFolderPath = this.normalizeFolderPath(path);
      const ids = this.extractDragIds(event);
      try {
        if (ids.length) await this.performFolderMove({ ids, targetFolderPath });
      } finally {
        this.handleFileDragEnd();
      }
    },
    },
  });
}
