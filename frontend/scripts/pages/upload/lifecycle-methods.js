{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
    initializeUploadPreferences() {
      this.loadImageUploadDecision();
      this.loadImageCompressSettings();
      this.detectImageCompressionSupport();
      this.folderPath = this.normalizeFolderPath(localStorage.getItem('uploadFolderPath') || '');
    },
    registerUploadDocumentEvents() {
      document.addEventListener('fullscreenchange', this.handlePreviewFullscreenChange);
      document.addEventListener('webkitfullscreenchange', this.handlePreviewFullscreenChange);
      document.addEventListener('paste', this.handleDocumentPaste);
      document.addEventListener('keydown', this.handleUploadKeydown);
    },
    async handleDocumentPaste(event) {
      const items = event.clipboardData?.items;
      if (!items) return;
      const files = [];
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const extension = item.type.split('/')[1];
        files.push(new File([blob], `paste_${Date.now()}.${extension}`, { type: item.type }));
      }
      if (!files.length) return;
      event.preventDefault();
      await this.prepareFilesForUpload(files);
    },
    handleUploadKeydown(event) {
      if (event.key === 'Escape' && this.previewData) this.closePreview();
    },
  }});
}
