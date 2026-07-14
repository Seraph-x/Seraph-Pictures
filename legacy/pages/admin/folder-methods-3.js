{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
resolveDraggedIds(item) {
        if (!item || !item.name) return [];
        if (item.selected) {
          const selected = this.selectedFiles.map((file) => file.name).filter(Boolean);
          if (selected.length > 0) return selected;
        }
        return [item.name];
      },
handleFileDragStart(item, event) {
        const ids = this.resolveDraggedIds(item);
        if (!ids.length) return;
        if (event?.currentTarget?.classList) {
          event.currentTarget.classList.add('dragging-file-card');
        }
        this.dragState.active = true;
        this.dragState.fileIds = ids;
        this.dragState.targetPath = null;
        document.body.classList.add('is-dragging-files');
        if (event && event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-kvault-files', JSON.stringify(ids));
          event.dataTransfer.setData('text/plain', ids.join(','));
          const dragGhost = document.createElement('div');
          dragGhost.textContent = ids.length > 1 ? this.t('admin.dragMoveN', { n: ids.length }) : (item?.metadata?.fileName || item?.name || this.t('admin.dragMoveFile'));
          dragGhost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;padding:8px 12px;border-radius:999px;background:rgba(19,29,48,0.92);color:#fff;font-size:12px;pointer-events:none;z-index:9999;';
          document.body.appendChild(dragGhost);
          event.dataTransfer.setDragImage(dragGhost, 18, 16);
          requestAnimationFrame(() => dragGhost.remove());
        }
      },
handleFileDragEnd() {
        if (this.dragState.leaveTimer) {
          clearTimeout(this.dragState.leaveTimer);
          this.dragState.leaveTimer = null;
        }
        if (this.dragState.rafId) {
          cancelAnimationFrame(this.dragState.rafId);
          this.dragState.rafId = null;
        }
        this.dragState.active = false;
        this.dragState.fileIds = [];
        this.dragState.targetPath = null;
        document.body.classList.remove('is-dragging-files');
        document.querySelectorAll('.dragging-file-card').forEach((node) => node.classList.remove('dragging-file-card'));
      },
handleFolderDragOver(path, event) {
        if (!this.dragState.active) return;
        if (event && event.dataTransfer) {
          event.dataTransfer.dropEffect = 'move';
        }
      },
handleFolderDragEnter(path) {
        if (!this.dragState.active) return;
        const normalizedPath = this.normalizeFolderPath(path);
        if (this.dragState.leaveTimer) {
          clearTimeout(this.dragState.leaveTimer);
          this.dragState.leaveTimer = null;
        }
        if (this.dragState.targetPath === normalizedPath) return;
        if (this.dragState.rafId) {
          cancelAnimationFrame(this.dragState.rafId);
          this.dragState.rafId = null;
        }
        this.dragState.rafId = requestAnimationFrame(() => {
          this.dragState.targetPath = normalizedPath;
          this.dragState.rafId = null;
        });
      },
handleFolderDragLeave(path, event) {
        if (!this.dragState.active) return;
        const currentTarget = event?.currentTarget;
        const relatedTarget = event?.relatedTarget;
        if (currentTarget && relatedTarget && currentTarget.contains(relatedTarget)) {
          return;
        }
        const normalizedPath = this.normalizeFolderPath(path);
        if (this.dragState.leaveTimer) {
          clearTimeout(this.dragState.leaveTimer);
        }
        this.dragState.leaveTimer = setTimeout(() => {
          if (this.dragState.targetPath === normalizedPath) {
            this.dragState.targetPath = null;
          }
          this.dragState.leaveTimer = null;
        }, 60);
      },
extractDragIds(event) {
        if (this.dragState.fileIds.length > 0) return this.dragState.fileIds;
        const raw = event?.dataTransfer?.getData('application/x-kvault-files') || '';
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map((item) => String(item || '')).filter(Boolean) : [];
        } catch {
          return [];
        }
      },
async handleFolderDrop(path, event) {
        return this.dropFilesIntoFolder(path, event);
      }
  }});
}
