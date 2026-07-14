{
  'use strict';
  const shared = globalThis.LegacyAdminSettingsShared;
  const template = globalThis.LegacyAdminSettingsTemplates.guest;
  const DEFAULT_GUEST = Object.freeze({
    enabled: false, retentionDays: 3, dailyLimit: 10, maxFileSize: 5 * 1024 * 1024,
  });

  function guestRequest(method, config) {
    const query = method === 'GET' ? `?_ts=${Date.now()}` : '';
    const body = method === 'GET' ? undefined : { config };
    return shared.requestJson({ method, url: `/api/guest-config${query}`, ...(body ? { body } : {}) });
  }

  function guestValues(config) {
    return Object.freeze({
      enabled: config.enabled ? 'checked' : '',
      retentionDays: Math.max(0, Math.round(Number(config.retentionDays) || 0)),
      dailyLimit: shared.clamp(config.dailyLimit, 0, 1000),
      maxFileSize: Math.round((Number(config.maxFileSize) / 1024 / 1024) * 10) / 10,
    });
  }

  function readGuestForm() {
    const value = (id) => document.getElementById(id)?.value;
    return Object.freeze({
      enabled: Boolean(document.getElementById('guestEnabled')?.checked),
      retentionDays: Math.max(0, Math.round(Number(value('guestRetentionDays')) || 0)),
      dailyLimit: shared.clamp(value('guestDailyLimit'), 0, 1000),
      maxFileSize: Math.round(shared.clamp(value('guestMaxFileSize'), 0, 20) * 1024 * 1024),
    });
  }

  async function saveGuest(context, instance, done) {
    instance.confirmButtonLoading = true;
    shared.setStatus('guestSaveStatus', 'saving', context.vm.t('admin.guestSaving'));
    try {
      const savedPayload = await guestRequest('POST', readGuestForm());
      const verifiedPayload = await guestRequest('GET');
      if (JSON.stringify(savedPayload.config) !== JSON.stringify(verifiedPayload.config)) {
        throw new Error('GUEST_SETTINGS_VERIFY_FAILED');
      }
      shared.setStatus('guestSaveStatus', 'success', context.vm.t('admin.guestSaved'));
      context.vm.$message.success(context.vm.t('admin.guestSavedMsg', { binding: savedPayload.binding || '' }));
      done();
    } catch (error) {
      shared.setStatus('guestSaveStatus', 'warning', error.message);
      context.vm.$message.error(context.vm.t('admin.guestSaveFailed', { msg: error.message }));
    } finally { instance.confirmButtonLoading = false; }
  }

  function openGuestDialog(context, html) {
    context.vm.$alert(html, context.vm.t('admin.guestPanelTitle'), {
      customClass: 'ui-design-alert ui-design-footer-actions', dangerouslyUseHTMLString: true,
      showCancelButton: true, closeOnClickModal: false,
      confirmButtonText: context.vm.t('admin.guestSaveSettings'), cancelButtonText: context.vm.t('admin.cancel'),
      beforeClose(action, instance, done) {
        if (action !== 'confirm') { done(); return; }
        saveGuest(context, instance, done);
      },
    });
  }

  async function showGuestSettingsPanel() {
    const payload = await guestRequest('GET');
    const config = Object.freeze({ ...DEFAULT_GUEST, ...(payload.config || {}) });
    const html = shared.renderTemplate(template, { t: this.t, values: guestValues(config) });
    openGuestDialog(Object.freeze({ vm: this }), html);
  }

  globalThis.LegacyAdminGuest = Object.freeze({ showGuestSettingsPanel });
}
