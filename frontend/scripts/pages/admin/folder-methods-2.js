{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
async requestCreateFolder(path) {
        const response = await fetch('/api/drive/folders', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) throw new Error(result.error?.code || 'FOLDER_CREATE_FAILED');
        return result.folder;
      },
async createFolder() {
        if (this.folderMutating) return;
        const seed = this.folderPath ? `${this.folderPath}/${this.t('admin.newFolderSeed')}` : this.t('admin.newFolderSeed');
        let prompt;
        try {
          prompt = await this.$prompt(this.t('admin.createFolderPrompt'), this.t('admin.createFolderTitle'), {
            inputValue: seed, confirmButtonText: this.t('admin.confirmCreate'), cancelButtonText: this.t('admin.cancel'),
            inputValidator: (value) => Boolean(this.normalizeFolderPath(value)) || this.t('admin.folderPathEmpty'),
          });
        } catch (error) {
          if (error === 'cancel' || error === 'close') return;
          throw error;
        }
        const path = this.normalizeFolderPath(prompt.value);
        if ((this.folders || []).some((folder) => this.normalizeFolderPath(folder.path) === path)) {
          await this.selectFolder(path);
          this.$message.info(this.t('admin.folderExistsSwitched'));
          return;
        }
        this.folderMutating = true;
        this.folderMutatingAction = 'create';
        try {
          await this.requestCreateFolder(path);
          this.folderPath = path;
          this.currentPage = 1;
          this.clearFolderCache();
          await Promise.all([this.fetchFolders(), this.refreshFileList()]);
          this.$message.success(this.t('admin.folderCreateSuccess'));
        } finally {
          this.folderMutating = false;
          this.folderMutatingAction = '';
        }
      },
async promptFolderRenameTarget() {
        const parts = this.folderPath.split('/');
        const oldName = parts.at(-1) ?? '';
        const prefix = parts.slice(0, -1).join('/');
        try {
          const prompt = await this.$prompt(this.t('admin.renameFolderPrompt'), this.t('admin.renameFolderTitle'), {
            inputValue: oldName, confirmButtonText: this.t('admin.confirmSave'),
            cancelButtonText: this.t('admin.cancel'),
            inputValidator: (value) => Boolean(String(value ?? '').trim()) || this.t('admin.folderNameEmpty'),
          });
          const name = String(prompt.value ?? '').trim();
          return this.normalizeFolderPath(prefix ? `${prefix}/${name}` : name);
        } catch (error) {
          if (this.isDialogCancellation(error)) return '';
          throw error;
        }
      },
async requestRenameFolder(options) {
        const response = await fetch('/api/drive/folders/move', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        });
        const result = await response.json();
        if (response.ok && result.success === true) return result;
        throw new Error(result.error?.code ?? this.t('admin.renameFailed'));
      },
async renameCurrentFolder() {
        if (!this.folderPath || this.folderMutating) return;
        const targetPath = await this.promptFolderRenameTarget();
        if (!targetPath || targetPath === this.folderPath) return;
        const sourcePath = this.folderPath;
        const previousFolders = this.cloneFoldersSnapshot();
        this.folderMutating = true;
        this.folderMutatingAction = 'rename';
        this.renameFolderBranchLocal(sourcePath, targetPath);
        this.folderPath = targetPath;
        try {
          await this.requestRenameFolder({ sourcePath, targetPath });
          this.$message.success(this.t('admin.folderRenameSuccess'));
          this.clearFolderCache();
          await Promise.all([this.fetchFolders(), this.refreshFileList()]);
        } catch (error) {
          this.folders = previousFolders;
          this.folderPath = sourcePath;
          await this.refreshFileList();
          this.$message.error(error.message ?? this.t('admin.folderRenameFailed'));
          throw error;
        } finally {
          this.folderMutating = false;
          this.folderMutatingAction = '';
        }
      },
async confirmFolderDelete() {
        try {
          await this.$confirm(this.t('admin.deleteFolderConfirm'), this.t('admin.deleteFolderTitle'), {
            type: 'warning', confirmButtonText: this.t('admin.confirmDelete'),
            cancelButtonText: this.t('admin.cancel'),
          });
          return true;
        } catch (error) {
          if (this.isDialogCancellation(error)) return false;
          throw error;
        }
      },
async requestDeleteFolder(path) {
        const query = new URLSearchParams({ path, recursive: '1' });
        const response = await fetch(`/api/drive/folders?${query.toString()}`, {
          method: 'DELETE', credentials: 'include',
        });
        const result = await response.json();
        if (response.ok && result.success === true) return result;
        throw new Error(result.error?.code ?? this.t('admin.deleteFolderFailed'));
      },
async deleteCurrentFolder() {
        if (!this.folderPath || this.folderMutating) return;
        if (!await this.confirmFolderDelete()) return;
        const target = this.folderPath;
        const previousFolders = this.cloneFoldersSnapshot();
        const previousFolderPath = this.folderPath;
        this.folderMutating = true;
        this.folderMutatingAction = 'delete';
        this.removeFolderBranchLocal(target);
        this.folderPath = this.normalizeFolderPath(target.split('/').slice(0, -1).join('/'));
        this.currentPage = 1;
        this.tableData = [];
        this.nextCursor = null;
        try {
          await this.requestDeleteFolder(target);
          this.clearFolderCache();
          await Promise.all([this.fetchFolders(), this.refreshFileList()]);
          this.$message.success(this.t('admin.folderDeleteSuccess'));
        } catch (error) {
          this.folders = previousFolders;
          this.folderPath = previousFolderPath;
          await this.refreshFileList();
          this.$message.error(error.message ?? this.t('admin.folderDeleteFailed'));
          throw error;
        } finally {
          this.folderMutating = false;
          this.folderMutatingAction = '';
        }
      },
async moveSelectedToFolder() {
        return this.promptFolderMove();
      },
resetViewConditions() {
        this.search = '';
        this.filterOption = 'all';
        this.storageFilter = 'all';
        this.fileType = 'all';
        this.folderPath = '';
        this.currentPage = 1;
        this.refreshFileList({ syncFolders: true });
        this.$message.success(this.t('admin.resetFiltersDone'));
      }
  }});
}
