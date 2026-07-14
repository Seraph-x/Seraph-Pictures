{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
validAdminUploads(files) {
        const valid = files.filter((file) => file.size <= this.uploadConfig.maxSize);
        const invalid = files.filter((file) => file.size > this.uploadConfig.maxSize);
        if (invalid.length) {
          this.$message.error(this.t('admin.uploadOverSize', {
            size: this.uploadConfig.maxSize / 1024 / 1024,
            names: invalid.map((file) => file.name).join('\n'),
          }));
        }
        return valid;
      },
async uploadAdminFile(options) {
        const formData = new FormData();
        formData.append('file', options.file);
        formData.append('folderPath', this.folderPath || '');
        formData.append('storageMode', options.profile.type);
        formData.append('storageId', options.profile.id);
        const response = await fetch(`${this.baseURL}/upload`, {
          method: 'POST', body: formData, credentials: 'include',
        });
        const data = await response.json();
        const error = Array.isArray(data) ? data[0]?.error : data?.error;
        if (!response.ok || error) throw new Error(error || 'UPLOAD_FAILED');
        const src = data[0]?.src;
        if (!src) throw new Error('UPLOAD_RESPONSE_INVALID');
        return src;
      },
async uploadAdminBatch(options) {
        const failures = [];
        let uploaded = 0;
        for (let index = 0; index < options.files.length; index += this.uploadConfig.maxConcurrent) {
          const batch = options.files.slice(index, index + this.uploadConfig.maxConcurrent);
          const results = await Promise.allSettled(batch.map((file) => this.uploadAdminFile({ file, profile: options.profile })));
          results.forEach((result, resultIndex) => {
            if (result.status === 'fulfilled') uploaded += 1;
            else failures.push(`${batch[resultIndex].name} (${result.reason.message})`);
          });
        }
        return Object.freeze({ uploaded, failures });
      },
async confirmAdminUpload(options) {
        const folder = this.folderPath ? ` / ${this.folderPath}` : ` / ${this.t('admin.rootDir')}`;
        await this.$confirm(
          this.t('admin.uploadConfirmMsg', { count: options.count, target: options.target, folder }),
          this.t('admin.uploadConfirmTitle'),
          { type: 'info', dangerouslyUseHTMLString: true,
            confirmButtonText: this.t('admin.startUpload'), cancelButtonText: this.t('admin.cancel') },
        );
      },
async uploadFiles(event) {
        const files = this.validAdminUploads(Array.from(event.target.files || []));
        event.target.value = '';
        if (!files.length) return;
        const profile = this.selectedStorageProfile;
        if (!profile?.enabled) throw new Error('STORAGE_SELECTION_REQUIRED');
        const target = `${profile.type} · ${profile.name}`;
        await this.confirmAdminUpload({ count: files.length, target });
        const loading = this.$message({ message: this.t('admin.uploadingTo', { target }), duration: 0 });
        try {
          const result = await this.uploadAdminBatch({ files, profile });
          if (result.uploaded) this.$message.success(`成功上传 ${result.uploaded} 个文件到 ${target}`);
          if (result.failures.length) this.$message.error(`上传失败: ${result.failures.join(', ')}`);
          this.clearFolderCache();
          await this.refreshFileList();
        } finally { loading.close(); }
      },
restoreCachedFileList(options) {
        if (!options.preferCache || options.force) return false;
        const cached = this.readFolderCache(options.cacheKey);
        if (!cached) return false;
        this.applyFolderCacheEntry(cached);
        this.currentPage = 1;
        this.refreshFileList({ syncFolders: options.syncFolders, force: true, silent: true });
        return true;
      },
applyFileListResult(options) {
        const mapped = (options.result.files || []).map((file) => this.normalizeListItem(file));
        this.tableData = mapped;
        this.nextCursor = options.result.list_complete ? null : options.result.cursor;
        const total = options.result?.stats?.total;
        this.totalCount = Number.isFinite(total) ? total : mapped.length;
        this.updateStats();
        this.calculatePageSize();
        this.sortData(this.tableData);
        this.normalizeCurrentPage();
        this.writeFolderCache(options.cacheKey);
      },
async refreshFileList(options = {}) {  // 不刷新页面，仅更新数据
        const { syncFolders = false, preferCache = false, force = false, silent = false } = options;
        const cacheKey = this.getFolderCacheKey();
        if (this.restoreCachedFileList({ preferCache, force, cacheKey, syncFolders })) return;
        const requestSeq = ++this.listRequestSeq;
        try {
          const params = this.buildListQueryParams({
            limit: this.getListRequestLimit(false),
            includeStats: true,
          });
          const result = await fetch(`/api/drive/explorer?${params.toString()}`, { method: 'GET', credentials: 'include' })
            .then(response => response.json());
          if (result.success !== true) throw new Error(result.error?.code || 'DRIVE_LIST_FAILED');
          if (requestSeq !== this.listRequestSeq) return;
          this.applyFileListResult({ result, cacheKey });
          if (syncFolders) await this.fetchFolders();
        } catch (error) {
          if (requestSeq !== this.listRequestSeq) return;
          if (!silent) this.$message.error('刷新文件列表失败，请检查网络连接');
          throw error;
        }
      },
toggleSelect(index, name) {
        const fileIndex = this.tableData.findIndex(file => file.name === name);
        this.tableData[fileIndex].selected = !this.tableData[fileIndex].selected;
      },
toggleLike(index, name) {
        console.log(`Toggling like for : ${name}`);
        const fileIndex = this.tableData.findIndex(file => file.name === name);
        // 乐观更新收藏状态
        this.tableData[fileIndex].metadata.liked = !(this.tableData[fileIndex].metadata.liked ?? false);
        // 发送请求更新服务器数据
        var requestOptions = { method: 'POST', redirect: 'follow', credentials: 'include' };
        fetch(`/api/manage/toggleLike/${name}`, requestOptions)
          .then(response => response.json())
          .then(result => {
            if (!result.success) {  // 如果服务器更新失败，将状态还原
              this.tableData[fileIndex].metadata.liked = !this.tableData[fileIndex].metadata.liked;
              this.$message({message: '更新收藏状态失败，请稍后重试', type: 'error'});
            } else {
              this.$message.success(this.tableData[fileIndex].metadata.liked ? '收藏成功' : '取消收藏');
            }
          })
          .catch(error => { // 如果服务器响应错误，将状态还原
            this.tableData[fileIndex].metadata.liked = !this.tableData[fileIndex].metadata.liked;
            this.$message({message: '同步服务器失败，请检查网络连接', type: 'error'});
          });
      },
async handleDelete(index, key) {
        const isR2 = key.startsWith('r2:');
        const storageInfo = isR2 ? 'R2 存储和 KV 记录' : 'KV 记录';
        try {
          await this.$confirm(`此操作将永久删除该文件的 ${storageInfo}, 是否继续?`, '提示', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
          });
        } catch (error) {
          if (this.isDialogCancellation(error)) {
            this.$message.info('已取消删除');
            return;
          }
          throw error;
        }
        try {
          const encodedKey = encodeURIComponent(key);
          const response = await fetch(`/api/manage/delete/${encodedKey}`, {
            method: 'DELETE', credentials: 'include',
          });
          const result = await response.json();
          this.assertDeleteResponse({ response, result });
          const fileIndex = this.tableData.findIndex((file) => file.name === key);
          if (fileIndex !== -1) this.tableData.splice(fileIndex, 1);
          this.updateStats();
          this.clearFolderCache();
          this.$message.success('删除成功！');
        } catch (error) {
          this.$message.error(`删除失败: ${error.message}`);
          throw error;
        }
      },
isDialogCancellation(error) {
        return error === 'cancel' || error === 'close';
      },
assertDeleteResponse(options) {
        if (options.response.ok && options.result.success === true) return;
        const failure = options.result.error;
        throw new Error(failure?.code || failure || '删除失败');
      },
copyToClipboardFallback(text) {
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);
        textarea.style.position = 'fixed';
        textarea.style.clip = 'rect(0 0 0 0)';
        textarea.style.top = '10px';
        textarea.value = text;
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      },
handleCopy(index, key) {
        const link = `${this.baseURL}/file/${key}`;
        (navigator.clipboard?.writeText(link) || this.copyToClipboardFallback(link))
          .then(() => this.$message.success('复制文件链接成功~'))
          .catch(() => this.$message.error('自动复制失败，请手动复制链接：' + link));
      },
handleQuickCopy(format, key) {  // 快速复制不同格式
        const url = `${this.baseURL}/file/${key}`;
        const file = this.tableData.find(f => f.name === key);
        const name = file?.metadata?.fileName || key;
        let link = url;

        switch (format) {
          case 'markdown':
            link = `![${name}](${url})`;
            break;
          case 'html':
            link = `<img src="${url}" alt="${name}">`;
            break;
          case 'bbcode':
            link = `[img]${url}[/img]`;
            break;
          default:
            link = url;
        }

        (navigator.clipboard?.writeText(link) || this.copyToClipboardFallback(link))
          .then(() => this.$message.success(`${format.toUpperCase()} 格式链接已复制~`))
          .catch(() => this.$message.error('复制失败'));
      },
selectAllInPage() {  // 全选当前页
        const selected = !this.paginatedTableData.every(file => file.selected);
        this.paginatedTableData.forEach(file => file.selected = selected);
      }
  }});
}
