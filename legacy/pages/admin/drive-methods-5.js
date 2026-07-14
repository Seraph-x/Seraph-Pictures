{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
async showStorageConfigPanel() {
        const loading = this.$message({ message: this.t('admin.readingStorageStatus'), duration: 0 });
        try {
          const status = await this.fetchSystemStatus();
          loading.close();
          const rows = [
            ['Telegram', 'fab fa-telegram', status.telegram],
            ['R2', 'fas fa-cloud', status.r2],
            ['S3', 'fas fa-database', status.s3],
            ['Discord', 'fab fa-discord', status.discord],
            ['HuggingFace', 'fas fa-robot', status.huggingface],
            ['WebDAV', 'fas fa-hard-drive', status.webdav],
            ['GitHub', 'fab fa-github', status.github],
            ['KV', 'fas fa-key', status.kv],
          ].map(([label, icon, item]) => `
            <div class="storage-status-card">
              <div class="storage-status-card-head">
                <i class="${icon}"></i>
                <strong>${label}</strong>
                <span style="background:${this.getStatusColor(item)}"></span>
              </div>
              <p>${this.getStatusMark(item)} ${item?.message || this.t('admin.statusUnknown')}</p>
            </div>
          `).join('');
          const html = `
            <div class="storage-config-panel">
              <div class="storage-config-grid">${rows}</div>
            </div>
          `;
          this.$alert(html, this.t('admin.storageStatusTitle'), {
            customClass: 'storage-config-alert',
            dangerouslyUseHTMLString: true,
            confirmButtonText: this.t('admin.close')
          });
        } catch (error) {
          loading.close();
          this.$message.error(this.t('admin.readStorageFailed').replace('{msg}', error.message));
        }
      }
  }});
}
