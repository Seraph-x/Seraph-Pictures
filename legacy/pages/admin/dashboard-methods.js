{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
openUploader() {  // 打开上传中心
        window.location.href = '/';
      },
exportAllLinks() {  // 导出全部链接
        const loading = this.$message({ message: '正在生成链接列表...', duration: 0 });
        const links = this.tableData.map(file => `${document.location.origin}/file/${file.name}`);
        const linksText = links.join('\n');

        // 创建下载文件
        const blob = new Blob([linksText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `image-links-${new Date().toISOString().slice(0,10)}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        loading.close();
        this.$message.success(`已导出 ${links.length} 个链接`);
      },
switchFileType(type, showMessage = true) {  // 切换文件类型
        this.fileType = type;
        this.currentPage = 1;
        localStorage.setItem('fileType', type);
        if (showMessage) {
          this.$message({
            message: `已切换为${this.fileConfig[type].name}模式, 共${this.fileConfig[type].count}个文件`,
            type: 'success',
            duration: 1500
          });
        }
      },
checkBrokenFiles() {  // 检测失效文件
        const loadingMessage = this.$message({ message: '正在检测失效文件...', duration: 0});

        let brokenCount = 0;
        const promises = this.tableData.map((item, index) => {
          const fileIndex = this.tableData.findIndex(item => item.name === this.selectedFiles[index].name);
          return new Promise((resolve) => {
            fetch(`${this.baseURL}/file/${item.name}`, {
              method: 'HEAD',
              cache: 'no-cache'  // 避免缓存影响检测结果
            })
              .then(response => {
                if (!response.ok) {
                  brokenCount++;
                  this.tableData[fileIndex].selected = true;
                  resolve({ index, status: 'error' });
                } else {
                  resolve({ index, status: 'success' });
                }
              })
              .catch(() => {
                brokenCount++;
                this.tableData[fileIndex].selected = true;
                resolve({ index, status: 'error' });
              });
          });
        });

        Promise.all(promises).then(() => {
          loadingMessage.close();
          if (brokenCount > 0) {
            this.$message({
              dangerouslyUseHTMLString: true,
              message: `检测到 ${brokenCount} 个失效文件，已自动选中。<br>您可以使用批量删除功能移除它们。`,
              type: 'warning',
              duration: 5000
            });
          } else {
            this.$message({
              message: '未检测到失效文件',
              type: 'success'
            });
          }
        });
      },
getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const iconMap = {
          'pdf': 'fas fa-file-pdf',
          'doc,docx': 'fas fa-file-word',
          'xls,xlsx,csv': 'fas fa-file-excel',
          'ppt,pptx': 'fas fa-file-powerpoint',
          'txt,md,log': 'fas fa-file-lines',
          'zip,rar,7z,tar,gz': 'fas fa-file-zipper',
          'html,htm,css,js,ts,jsx,tsx,vue,php,py,java,c,cpp,h,hpp,cs,go,rs,rb,pl,sh,sql': 'fas fa-file-code',
          'json,xml,yaml,yml,toml': 'fas fa-file-code',
          'mp4,avi,mov,wmv,flv,mkv,webm': 'fas fa-file-video',
          'mp3,wav,ogg,flac,aac,m4a,wma': 'fas fa-file-audio',
          'jpg,jpeg,png,gif,bmp,webp,svg,ico': 'fas fa-file-image',
          'psd,ai,eps,cdr': 'fas fa-file-image',
          'exe,msi,app,dmg,deb,rpm': 'fas fa-file-arrow-down'
        };
        for(const [exts, icon] of Object.entries(iconMap)) {
          if(exts.split(',').includes(ext)) {
            return icon;
          }
        }
        return 'fas fa-file';
      },
getFileType(filename) {
        const ext = filename.split('.').pop();
        return `${ext.toUpperCase()}`;
      },
handleEditName(item) {
        this.$prompt('', '修改文件名', {
          inputValue: item.metadata?.fileName || item.name,
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          inputValidator: (value) => {
            if (!value) return '文件名不能为空';
            if (value.length > 64) return '文件名不能超过64个字符';
            return true;
          }
        }).then(({ value }) => {
          fetch(`/api/manage/editName/${item.name}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newName: value })
          })
          .then(response => response.json())
          .then(result => {
            if (result.success) {
              item.metadata.fileName = value;
              this.$message.success('文件名修改成功');
            } else {
              this.$message.error('文件名修改失败');
            }
          })
          .catch((error) => {
            this.$message.error('修改文件名时出错，请检查网络连接');
            throw error;
          });
        }).catch((error) => {
          if (error === 'cancel' || error === 'close') return;
          throw error;
        });
      },
handleLoadSettings(command) {
        if (command === 'safeMode') {
          this.safeMode = !this.safeMode;
          localStorage.setItem('safeMode', this.safeMode);
          this.$message.success(this.safeMode ? '安全模式已开启' : '安全模式已关闭');
        } else if (command === 'loginBackground') {
          this.showUiDesignSettingsPanel();
        } else {
          this.loadMode = command;
          localStorage.setItem('loadMode', command);
          const modeNames = { normal: '正常模式', dataSaver: '省流模式', noImage: '无图模式' };
          this.$message.success(`已切换为${modeNames[command]}`);
        }
      },
showLoginBackgroundSettings() {
        this.showUiDesignSettingsPanel();
      },
async uploadUiDesignBackgroundFile(file) {
        if (!file) return '';
        const profile = this.selectedStorageProfile;
        if (!profile?.enabled) throw new Error('STORAGE_SELECTION_REQUIRED');
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folderPath', this.folderPath || '');
        formData.append('storageMode', profile.type);
        formData.append('storageId', profile.id);
        const response = await fetch(`${this.baseURL}/upload`, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload) || !payload[0]?.src) {
          const message = Array.isArray(payload) ? payload[0]?.error : payload?.error;
          throw new Error(message || this.t('admin.uploadFailed'));
        }
        return `${this.baseURL}${payload[0].src}`;
      }
  }});
}
