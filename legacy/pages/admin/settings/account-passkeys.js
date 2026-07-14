{
  'use strict';
  const shared = globalThis.LegacyAdminSettingsShared;

  function passkeyRequest(method, body) {
    return shared.requestJson({
      method, url: '/api/auth/passkey/credentials',
      ...(body === undefined ? {} : { body }),
    });
  }

  function passkeyItem(credential, t) {
    const esc = shared.escapeHtml;
    const date = credential.createdAt ? new Date(credential.createdAt).toLocaleString() : '';
    return `<div class="acc-passkey-item"><div class="acc-passkey-meta"><i class="fas fa-key"></i><div><div class="acc-passkey-name">${esc(credential.name)}</div><div class="acc-passkey-date">${esc(date)}</div></div></div><div class="acc-passkey-actions"><button type="button" class="acc-passkey-mini" data-pk-rename="${esc(credential.id)}" title="${esc(t('admin.accountPasskeyRename'))}"><i class="fas fa-pen"></i></button><button type="button" class="acc-passkey-mini danger" data-pk-delete="${esc(credential.id)}" title="${esc(t('admin.accountPasskeyDelete'))}"><i class="fas fa-trash"></i></button></div></div>`;
  }

  async function loadPasskeys(context) {
    const data = await passkeyRequest('GET');
    const box = document.getElementById('accPasskeyList');
    if (!box) return;
    const credentials = data.credentials || [];
    box.innerHTML = credentials.length
      ? credentials.map((item) => passkeyItem(item, context.vm.t)).join('')
      : `<div class="acc-passkey-empty">${shared.escapeHtml(context.vm.t('admin.accountPasskeyEmpty'))}</div>`;
    bindPasskeyActions(context, box);
  }

  function bindPasskeyActions(context, box) {
    box.querySelectorAll('[data-pk-rename]').forEach((button) => {
      button.addEventListener('click', () => renamePasskey(context, button.dataset.pkRename));
    });
    box.querySelectorAll('[data-pk-delete]').forEach((button) => {
      button.addEventListener('click', () => deletePasskey(context, button.dataset.pkDelete));
    });
  }

  async function renamePasskey(context, id) {
    const name = window.prompt(context.vm.t('admin.accountPasskeyRenamePrompt'));
    if (name == null || !name.trim()) return;
    await passkeyRequest('PATCH', { id, name: name.trim() });
    context.vm.$message.success(context.vm.t('admin.accountPasskeyRenamed'));
    await loadPasskeys(context);
  }

  async function deletePasskey(context, id) {
    if (!window.confirm(context.vm.t('admin.accountPasskeyDeleteConfirm'))) return;
    await passkeyRequest('DELETE', { id });
    context.vm.$message.success(context.vm.t('admin.accountPasskeyDeleted'));
    await loadPasskeys(context);
  }

  async function registrationOptions() {
    return shared.requestJson({
      method: 'POST', url: '/api/auth/passkey/register/options', body: {},
    });
  }

  async function verifyRegistration(response, name) {
    return shared.requestJson({
      method: 'POST', url: '/api/auth/passkey/register/verify', body: { response, name },
    });
  }

  async function registerPasskey(context) {
    const browser = window.SimpleWebAuthnBrowser;
    if (!browser || !window.PublicKeyCredential) throw new Error('PASSKEY_UNSUPPORTED');
    const button = document.getElementById('accPasskeyRegister');
    if (button) button.disabled = true;
    shared.setStatus('accPasskeyStatus', 'saving', context.vm.t('admin.accountPasskeyRegistering'));
    try {
      const options = await registrationOptions();
      const response = await browser.startRegistration({ optionsJSON: options.options });
      const name = window.prompt(context.vm.t('admin.accountPasskeyNamePh')) || 'Passkey';
      await verifyRegistration(response, name);
      shared.setStatus('accPasskeyStatus', 'success', context.vm.t('admin.accountPasskeyRegistered'));
      await loadPasskeys(context);
    } finally { if (button) button.disabled = false; }
  }

  function bindPasskeys(context) {
    document.getElementById('accPasskeyRegister')?.addEventListener('click', () => {
      registerPasskey(context).catch((error) => {
        shared.setStatus('accPasskeyStatus', 'warning', error.message);
        context.vm.$message.error(context.vm.t('admin.accountPasskeyFailed', { msg: error.message }));
      });
    });
    loadPasskeys(context).catch((error) => {
      shared.setStatus('accPasskeyStatus', 'warning', error.message);
    });
  }

  globalThis.LegacyAdminPasskeys = Object.freeze({ bindPasskeys });
}
