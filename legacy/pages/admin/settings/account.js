{
  'use strict';
  const shared = globalThis.LegacyAdminSettingsShared;
  const template = globalThis.LegacyAdminSettingsTemplates.account;

  function credentialsRequest(method, body) {
    const query = method === 'GET' ? `?_ts=${Date.now()}` : '';
    return shared.requestJson({ method, url: `/api/auth/credentials${query}`, ...(body ? { body } : {}) });
  }

  function bindPasswordToggles() {
    document.querySelectorAll('.acc-pass-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.toggleFor);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.querySelector('i')?.classList.toggle('fa-eye-slash', show);
      });
    });
  }

  function inputValue(id) {
    return document.getElementById(id)?.value ?? '';
  }

  function changedUsername(current) {
    const candidate = inputValue('accNewUsername').trim();
    if (!candidate) return '';
    return candidate === current ? '' : candidate;
  }

  function changedPassword(vm) {
    const password = inputValue('accNewPassword');
    if (!password) return '';
    if (password.length < 6) throw new Error(vm.t('admin.accountPasswordTooShort'));
    if (password !== inputValue('accNewPassword2')) {
      throw new Error(vm.t('admin.accountPasswordMismatch'));
    }
    return password;
  }

  function accountPayload(current, vm) {
    const currentPassword = inputValue('accCurrentPassword');
    if (!currentPassword) throw new Error(vm.t('admin.accountNeedCurrentPassword'));
    const newUsername = changedUsername(current.username);
    const newPassword = changedPassword(vm);
    if (!newUsername && !newPassword) throw new Error(vm.t('admin.accountNothingToChange'));
    const usernamePatch = newUsername ? { newUsername } : {};
    const passwordPatch = newPassword ? { newPassword } : {};
    return Object.freeze({ currentPassword, ...usernamePatch, ...passwordPatch });
  }

  async function saveAccount(context, instance, done) {
    instance.confirmButtonLoading = true;
    shared.setStatus('accSaveStatus', 'saving', context.vm.t('admin.accountSaving'));
    try {
      await credentialsRequest('POST', accountPayload(context.current, context.vm));
      shared.setStatus('accSaveStatus', 'success', context.vm.t('admin.accountSavedMsg'));
      context.vm.$message.success(context.vm.t('admin.accountSavedMsg'));
      done();
    } catch (error) {
      shared.setStatus('accSaveStatus', 'warning', error.message);
      context.vm.$message.error(context.vm.t('admin.accountSaveFailed', { msg: error.message }));
    } finally { instance.confirmButtonLoading = false; }
  }

  function openAccountDialog(context, html) {
    context.vm.$alert(html, context.vm.t('admin.accountPanelTitle'), {
      customClass: 'ui-design-alert ui-design-footer-actions', dangerouslyUseHTMLString: true,
      showCancelButton: true, closeOnClickModal: false,
      confirmButtonText: context.vm.t('admin.accountSave'), cancelButtonText: context.vm.t('admin.cancel'),
      beforeClose(action, instance, done) {
        if (action !== 'confirm') { done(); return; }
        saveAccount(context, instance, done);
      },
    });
    context.vm.$nextTick(() => {
      bindPasswordToggles();
      globalThis.LegacyAdminPasskeys.bindPasskeys(context);
    });
  }

  async function showAccountSecurityPanel() {
    const current = await credentialsRequest('GET');
    const context = Object.freeze({ vm: this, current });
    const html = shared.renderTemplate(template, {
      t: this.t, values: { username: current.username || '—' },
    });
    openAccountDialog(context, html);
  }

  globalThis.LegacyAdminAccount = Object.freeze({ showAccountSecurityPanel });
}
