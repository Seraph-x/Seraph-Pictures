{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
    registerAdminEvents() {
      document.addEventListener('fullscreenchange', this.handlePreviewFullscreenChange);
      document.addEventListener('webkitfullscreenchange', this.handlePreviewFullscreenChange);
      window.addEventListener('resize', this.handleWindowResize);
      window.addEventListener('orientationchange', this.handleWindowResize);
      window.visualViewport?.addEventListener('resize', this.handleWindowResize);
      window.addEventListener('keydown', this.handleGlobalKeydown);
    },
    restoreAdminPreferences() {
      this.sortOption = localStorage.getItem('sortOption') || this.sortOption;
      this.filterOption = localStorage.getItem('filterOption') || this.filterOption;
      this.fileType = localStorage.getItem('fileType') || this.fileType;
      this.loadMode = localStorage.getItem('loadMode') || this.loadMode;
      this.safeMode = localStorage.getItem('safeMode') !== 'false';
      this.viewMode = localStorage.getItem('adminViewMode') || this.viewMode;
      this.folderPath = this.normalizeFolderPath(localStorage.getItem('adminFolderPath') || '');
    },
    initializeAdminViewport() {
      this.restoreFolderCache();
      this.updateViewportFlags();
      this.updateWindowWidth();
      this.$nextTick(() => {
        this.observeMobileNavHeight();
        this.queueMobileNavMetricsUpdate();
      });
    },
    async loadInitialAdminData() {
      await this.refreshFileList({ syncFolders: true });
      this.switchFileType(this.fileType, false);
    },
    async loadAdminStatus() {
      const response = await fetch('/api/status', { credentials: 'include' });
      const status = await response.json();
      if (!response.ok) throw new Error(status?.error || 'STATUS_REQUEST_FAILED');
      this.systemStatus = { ...this.systemStatus, ...(status || {}) };
    },
  }});
}
