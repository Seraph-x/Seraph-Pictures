{
  'use strict';
  if (!globalThis.LegacyAdminComponents) throw new Error('LEGACYADMIN_TEMPLATE_MISSING');
  const adminApi = globalThis.LegacyAdminApi.createAdminApi();
  const profileMixin = globalThis.LegacyAdminProfiles.createAdminProfileMixin({ api: adminApi });
  const migrationMixin = globalThis.LegacyAdminMigration.createMigrationMixin({ api: adminApi });
  new Vue({
    el: '#app',
    template: [
      globalThis.LegacyAdminComponents.pageShell,
      globalThis.LegacyAdminComponents.dashboardPanel,
      globalThis.LegacyAdminComponents.fileBrowser,
      globalThis.LegacyAdminComponents.fileDialogs,
      globalThis.LegacyAdminComponents.folderMoveDialog,
      globalThis.LegacyAdminComponents.fileToolbar,
    ].join('\n'),
    mixins: [...(globalThis.LegacyAdminMixins || []), profileMixin, migrationMixin],
async mounted() {
      if (window.I18n) I18n.onChange((lang) => { this.lang = lang; });
      this.registerAdminEvents();
      if (!await this.checkAdminAuth()) return;
      this.initializeAdminViewport();
      this.restoreAdminPreferences();
      await this.loadStorageProfiles();
      await this.loadInitialAdminData();
      await this.loadAdminStatus();
    },
beforeDestroy() {
      document.body.classList.remove('is-dragging-files');
      if (this.dragState.leaveTimer) {
        clearTimeout(this.dragState.leaveTimer);
        this.dragState.leaveTimer = null;
      }
      if (this.dragState.rafId) {
        cancelAnimationFrame(this.dragState.rafId);
        this.dragState.rafId = null;
      }
      document.removeEventListener('mousemove', this.onBatchDrag);
      document.removeEventListener('mouseup', this.stopBatchDrag);
      window.removeEventListener('keydown', this.handleGlobalKeydown);
      window.removeEventListener('resize', this.handleWindowResize);
      window.removeEventListener('orientationchange', this.handleWindowResize);
      document.removeEventListener('fullscreenchange', this.handlePreviewFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', this.handlePreviewFullscreenChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', this.handleWindowResize);
      }
      this.unobserveMobileNavHeight();
      if (this.mobileNavMetricsRaf) {
        cancelAnimationFrame(this.mobileNavMetricsRaf);
        this.mobileNavMetricsRaf = 0;
      }
      document.documentElement.style.removeProperty('--nav-height');
      document.documentElement.style.removeProperty('--nav-offset');
    }
  });
}
