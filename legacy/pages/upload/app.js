{
  'use strict';
  if (!globalThis.LegacyUploadComponents) throw new Error('LEGACYUPLOAD_TEMPLATE_MISSING');
  const storageApi = globalThis.LegacyStorageApi.createStorageApi();
  const profileMixin = globalThis.LegacyUploadProfiles.createUploadProfileMixin({
    api: storageApi,
    storage: globalThis.localStorage,
  });
  new Vue({
    el: '#app',
    template: [
      globalThis.LegacyUploadComponents.pageHeader,
      globalThis.LegacyUploadComponents.uploadPanel,
      globalThis.LegacyUploadComponents.urlUpload,
      globalThis.LegacyUploadComponents.uploadQueue,
      globalThis.LegacyUploadComponents.uploadResults,
      globalThis.LegacyUploadComponents.historyPanel,
      globalThis.LegacyUploadComponents.previewDialog,
      globalThis.LegacyUploadComponents.toast,
    ].join('\n'),
    mixins: [...(globalThis.LegacyUploadMixins || []), profileMixin],
async mounted() {
      if (window.I18n) I18n.onChange((lang) => { this.lang = lang; });
      this.registerUploadDocumentEvents();
      this.initializeUploadPreferences();
      if (!await this.checkAuth()) return;
      await this.checkStorageTarget();
      if (!this.isGuest) await this.loadStorageProfiles();
      this.loadHistory();
    }
  });
}
