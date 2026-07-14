{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async copyLink(file) {
            try {
              const link = this.formatLink(file);
              await this.copyToClipboard(link);
              this.showToast(this.t('home.toastLinkCopied'), "success");
            } catch (err) {
              this.showToast(this.t('home.toastCopyFailed'), "error");
            }
          },
copySelectedLinks() {
            const links = this.uploadedFiles
              .filter((f) => f.selected)
              .map((f) => this.formatLink(f))
              .join("\n");
            this.copyToClipboard(links);
            this.showToast(this.t('home.toastCopiedN', { count: this.selectedCount }), "success");
          },
copyAllLinks() {
            const links = this.uploadedFiles
              .map((f) => this.formatLink(f))
              .join("\n");
            this.copyToClipboard(links);
            this.showToast(
              this.t('home.toastCopiedN', { count: this.uploadedFiles.length }),
              "success",
            );
          },
selectAll() {
            const newState = !this.isAllSelected;
            this.uploadedFiles.forEach((f) => (f.selected = newState));
          },
clearResults() {
            this.uploadedFiles = [];
          },
clearUploadQueue() {
            this.uploadingFiles = this.uploadingFiles.filter(
              (f) => f.status === "uploading" || f.status === "processing",
            );
            if (this.uploadingFiles.length === 0) {
              this.showToast(this.t('home.toastQueueCleared'), "success");
            }
          },
async retryUpload(item) {
            item.status = "waiting";
            item.error = null;
            item.progress = 0;
            await this.uploadFile(item);
          },
async retryAllFailed() {
            const failed = this.uploadingFiles.filter(
              (f) => f.status === "error",
            );
            if (failed.length === 0) return;

            this.showToast(this.t('home.toastRetrying', { count: failed.length }), "info");

            // 重置状态
            failed.forEach((item) => {
              item.status = "waiting";
              item.error = null;
              item.progress = 0;
            });

            await this.startUpload();

            const successCount = failed.filter(
              (f) => f.status === "success",
            ).length;
            if (successCount > 0) {
              this.showToast(
                this.t('home.toastRetrySuccess', { count: successCount, total: failed.length }),
                "success",
              );
            }
          },
removeFromResults(file) {
            const idx = this.uploadedFiles.indexOf(file);
            if (idx !== -1) {
              this.uploadedFiles.splice(idx, 1);
            }
          },
toggleResultViewMode() {
            this.resultViewMode =
              this.resultViewMode === "grid" ? "list" : "grid";
          },
toggleUploadSort() {
            this.uploadSortDesc = !this.uploadSortDesc;
          },
downloadFile(file) {
            const link = document.createElement("a");
            // 使用核心方法获取干净的文件直链
            link.href = this.getCleanFileUrl(file);
            // 使用安全的文件名获取方法
            link.download = this.getDisplayName(file);
            link.click();
          }
  }});
}
