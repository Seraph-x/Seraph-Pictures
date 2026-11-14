{
  'use strict';

  class WebdavUploadActions {
    constructor(options) {
      this.options = options;
    }

    async uploadFiles(files, folderPath) {
      this.options.profileView.setUploadBusy(true);
      try {
        const target = this.options.profileController.snapshot(folderPath);
        for (let index = 0; index < files.length; index += 1) {
          this.options.onProgress(index + 1, files.length);
          const form = new this.options.FormDataClass();
          form.append('file', files[index]);
          this.options.selection.appendUploadTarget(form, target);
          const payload = await this.options.request('/upload', {
            method: 'POST', body: form,
          });
          this.options.onFileResult(payload);
        }
      } finally {
        this.options.profileView.setUploadBusy(false);
      }
    }

    async uploadUrl(sourceUrl, folderPath) {
      this.options.profileView.setUploadBusy(true);
      try {
        const target = this.options.profileController.snapshot(folderPath);
        const body = this.options.selection.buildUrlUploadPayload({
          url: sourceUrl, target,
        });
        return await this.options.request('/api/upload-from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } finally {
        this.options.profileView.setUploadBusy(false);
      }
    }
  }

  function createUploadActions(options) {
    return new WebdavUploadActions(options);
  }

  const uploadActions = Object.freeze({ createUploadActions });
  if (typeof module === 'object' && module.exports) module.exports = uploadActions;
  globalThis.LegacyWebdavUploadActions = uploadActions;
}
