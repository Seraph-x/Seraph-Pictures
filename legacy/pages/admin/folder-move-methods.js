{
  'use strict';

  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
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
    async promptFolderMove() {
      if (!this.selectedFiles.length) { this.$message.warning(this.t('admin.selectFilesFirst')); return; }
      let prompt;
      try {
        prompt = await this.$prompt(this.t('admin.moveFilesPrompt'), this.t('admin.moveFilesTitle'), {
          inputValue: this.folderPath || '', confirmButtonText: this.t('admin.confirmMove'),
          cancelButtonText: this.t('admin.cancel'),
        });
      } catch (error) {
        if (error === 'cancel' || error === 'close') return;
        throw error;
      }
      const targetFolderPath = this.normalizeFolderPath(prompt.value || '');
      const ids = this.selectedFiles.map((item) => item.name);
      if (!await this.performFolderMove({ ids, targetFolderPath })) {
        this.$message.info(this.t('admin.filesAlreadyInFolder')); return;
      }
      this.$message.success(this.t('admin.movedNToFolder', { n: ids.length, folder: targetFolderPath || this.t('admin.rootDir') }));
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
  }});
}
