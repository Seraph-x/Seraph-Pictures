{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
async requestBatchDelete(ids) {
        const response = await fetch('/api/drive/files/delete-batch', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const result = await response.json();
        if (!response.ok || result.success !== true) throw new Error(result.error?.code || 'BATCH_DELETE_FAILED');
        return result.mutation || result;
      },
async handleBatchDelete() {
        const ids = this.selectedFiles.map((file) => file.name);
        if (!ids.length) return;
        try {
          await this.$confirm(`此操作将永久删除这 ${ids.length} 个文件, 是否继续?`, '提示', {
            confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
          });
        } catch (error) {
          if (error === 'cancel' || error === 'close') return;
          throw error;
        }
        await this.requestBatchDelete(ids);
        const idSet = new Set(ids);
        this.tableData = this.tableData.filter((file) => !idSet.has(file.name));
        this.selectedFiles = [];
        this.updateStats();
        this.$message.success(`成功删除 ${ids.length} 个文件!`);
      },
handleBatchCopy() {  // 批量复制链接
        const links = this.selectedFiles.map(file => `${document.location.origin}/file/${file.name}`).join('\n');
        (navigator.clipboard?.writeText(links) || this.copyToClipboardFallback(links))
          .then(() => this.$message.success('批量复制链接成功~'));
      },
handleBatchCopyMarkdown() {  // 批量复制Markdown格式
        const links = this.selectedFiles.map(file => {
          const url = `${document.location.origin}/file/${file.name}`;
          const name = file.metadata?.fileName || file.name;
          return `![${name}](${url})`;
        }).join('\n');
        (navigator.clipboard?.writeText(links) || this.copyToClipboardFallback(links))
          .then(() => this.$message.success('Markdown格式链接已复制~'));
      },
handleBatchCopyHtml() {  // 批量复制HTML格式
        const links = this.selectedFiles.map(file => {
          const url = `${document.location.origin}/file/${file.name}`;
          const name = file.metadata?.fileName || file.name;
          return `<img src="${url}" alt="${name}">`;
        }).join('\n');
        (navigator.clipboard?.writeText(links) || this.copyToClipboardFallback(links))
          .then(() => this.$message.success('HTML格式链接已复制~'));
      },
handleBatchDownload() {  // 批量下载
        this.$message.info(`正在下载 ${this.selectedFiles.length} 个文件`, { duration: 1000 });
        this.selectedFiles.forEach((file, index) => {
          setTimeout(() => {
            const link = document.createElement('a');
            link.href = `/file/${file.name}`;
            link.download = file.metadata.fileName || file.name;
            link.click();
          }, index * 800);
        });
        this.selectedFiles = [];
      },
handleBatchBlockOrUnblock(type) {  // 批量加入黑/白名单
        if (type !== 'Block' && type !== 'White') { this.$message.error('无效的操作类型'); return; }
        const typeToName = { Block: '黑名单', White: '白名单' };
        this.$confirm(`确定要将这 ${this.selectedFiles.length} 个文件加入${typeToName[type]}吗?`, '提示', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        }).then(() => {
          const promises = this.selectedFiles.map(file => fetch(`/api/manage/${type.toLowerCase()}/${file.name}`, { method: 'POST', credentials: 'include' }));

          Promise.all(promises)
            .then(responses => {
              responses.forEach((response, index) => {
                if (response.ok) {
                  const fileIndex = this.tableData.findIndex(item => item.name === this.selectedFiles[index].name);
                  if (fileIndex !== -1) {
                    this.tableData[fileIndex].metadata.ListType = type;
                  }
                }
              });
              this.$message.success(`批量加入${typeToName[type]}成功`);
              this.selectedFiles = [];
            })
            .catch(() => this.$message.error(`操作失败，请检查网络连接`));
        });
      },
handleBatchOperation(command) {
        // 全选操作不需要检查已选文件
        if (command === 'selectAll') {
          this.selectAllInPage();
          return;
        }
        if (command === 'selectAllLoaded') {
          this.selectAllLoaded();
          return;
        }
        if (this.selectedFiles.length === 0) { this.$message.warning('请先选择文件'); return; }
        const actions = {
          copy: () => this.handleBatchCopy(), copyMarkdown: () => this.handleBatchCopyMarkdown(),
          copyHtml: () => this.handleBatchCopyHtml(), delete: () => this.handleBatchDelete(),
          download: () => this.handleBatchDownload(), moveFolder: () => this.moveSelectedToFolder(),
          block: () => this.handleBatchBlockOrUnblock('Block'),
          unblock: () => this.handleBatchBlockOrUnblock('White'),
        };
        actions[command]?.();
      },
selectAllInPage() {
        const newState = !this.isAllSelected;
        this.paginatedData.forEach(file => file.selected = newState);
        this.$message.success(newState ? `已选中当前页 ${this.paginatedData.length} 项` : '已取消选择');
      },
selectAllLoaded() {
        const allSelected = this.tableData.every(f => f.selected);
        this.tableData.forEach(file => file.selected = !allSelected);
        this.$message.success(!allSelected ? `已选中全部 ${this.tableData.length} 项` : '已取消选择');
      },
handleToolkit(command) {
        switch (command) {
          case 'selectAllInPage': this.selectAllInPage(); break;
          case 'checkBrokenFiles': this.checkBrokenFiles(); break;
          case 'openUploader': this.openUploader(); break;
          case 'exportLinks': this.exportAllLinks(); break;
          case 'manageApiTokens': this.openApiTokenDialog(); break;
          case 'checkStatus': this.checkConnectionStatus(); break;
        }
      },
getStatusColor(item) {
        if (item?.connected) return '#67c23a';
        if (this.isUnconfiguredStatus(item)) return '#909399';
        return '#f56c6c';
      },
getStatusMark(item) {
        if (item?.connected) return '✓';
        if (this.isUnconfiguredStatus(item)) return '○';
        return '✗';
      },
updateSystemStatus(status) {
        this.systemStatus = {
          ...this.systemStatus,
          ...(status || {}),
          github: status?.github || this.systemStatus.github,
          webdav: status?.webdav || this.systemStatus.webdav,
        };
      },
renderStatusRow(options) {
        const color = this.getStatusColor(options.item);
        const iconStyle = options.iconColor ? `color: ${options.iconColor};` : '';
        const message = options.item?.message || '未知';
        return `
          <p>
            <i class="${options.iconClass}" style="width: 20px; ${iconStyle}"></i>
            <b>${options.label}:</b>
            <span style="color: ${color}">${this.getStatusMark(options.item)} ${message}</span>
          </p>
        `;
      },
async fetchSystemStatus() {
        const response = await fetch('/api/status', { credentials: 'include' });
        const status = await response.json();
        this.updateSystemStatus(status);
        return status || {};
      },
async checkConnectionStatus() {
        const loading = this.$message({ message: '正在检查连接状态...', duration: 0 });
        try {
          const status = await this.fetchSystemStatus();
          loading.close();

          // 显示详细状态对话框
          const statusHtml = `
            <div style="line-height: 2;">
              ${this.renderStatusRow({ label: 'Telegram', iconClass: 'fas fa-robot', item: status.telegram })}
              ${this.renderStatusRow({ label: 'KV 存储', iconClass: 'fas fa-database', item: status.kv })}
              ${this.renderStatusRow({ label: 'R2 存储', iconClass: 'fas fa-cloud', item: status.r2 })}
              ${this.renderStatusRow({ label: 'S3 存储', iconClass: 'fas fa-database', item: status.s3, iconColor: '#e6a23c' })}
              ${this.renderStatusRow({ label: 'Discord', iconClass: 'fab fa-discord', item: status.discord, iconColor: '#7289da' })}
              ${this.renderStatusRow({ label: 'HuggingFace', iconClass: 'fas fa-robot', item: status.huggingface, iconColor: '#ff9d00' })}
              ${this.renderStatusRow({ label: 'WebDAV', iconClass: 'fas fa-hard-drive', item: status.webdav, iconColor: '#8f65ff' })}
              ${this.renderStatusRow({ label: 'GitHub', iconClass: 'fab fa-github', item: status.github, iconColor: '#24292f' })}
              <p><i class="fas fa-lock" style="width: 20px;"></i> <b>身份验证:</b>
                <span style="color: ${status.auth.enabled ? '#67c23a' : '#909399'}">
                  ${status.auth.enabled ? '✓' : '○'} ${status.auth.message}
                </span>
              </p>
            </div>
          `;

          this.$alert(statusHtml, '系统连接状态', {
            dangerouslyUseHTMLString: true,
            confirmButtonText: '确定'
          });
        } catch (error) {
          loading.close();
          this.$message.error('检查状态失败: ' + error.message);
        }
      },
openStorageSettings() {
        window.location.href = '/storage-settings';
      }
  }});
}
