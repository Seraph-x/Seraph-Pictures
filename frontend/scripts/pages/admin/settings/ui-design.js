{
  'use strict';
  const shared = globalThis.LegacyAdminSettingsShared;
  const template = globalThis.LegacyAdminSettingsTemplates.uiDesign;

  function checked(value) {
    return value ? 'checked' : '';
  }

  function uiValues(snapshot) {
    const mode = snapshot.loginBackgroundMode;
    const effect = snapshot.effectStyle || 'none';
    return Object.freeze({
      ...snapshot,
      cardOpacity: shared.clamp(snapshot.cardOpacity, 0, 100),
      cardBlur: shared.clamp(snapshot.cardBlur, 0, 32),
      effectIntensity: shared.clamp(snapshot.effectIntensity, 0, 100),
      followGlobal: checked(mode !== 'custom'), customLogin: checked(mode === 'custom'),
      effectNone: checked(effect === 'none'),
      effectFeather: checked(effect === 'feather'),
      effectDandelion: checked(effect === 'dandelion'),
      effectPetal: checked(effect === 'petal'),
      effectSnow: checked(effect === 'snow'),
      effectFirefly: checked(effect === 'firefly'),
      effectTexture: checked(effect === 'texture'),
      optimizeMobile: checked(snapshot.optimizeMobile !== false),
    });
  }

  function readUiForm() {
    const value = (id) => document.getElementById(id)?.value?.trim() || '';
    return Object.freeze({
      baseColor: '#fafaf8', brandName: value('uiBrandName'), brandLogoUrl: value('uiBrandLogoUrl'),
      globalBackgroundUrl: value('uiGlobalBgUrl'), loginBackgroundUrl: value('uiLoginBgUrl'),
      loginBackgroundMode: document.querySelector('input[name="uiLoginMode"]:checked')?.value || 'follow-global',
      cardOpacity: shared.clamp(value('uiCardOpacity'), 0, 100),
      cardBlur: shared.clamp(value('uiCardBlur'), 0, 32),
      effectStyle: document.querySelector('input[name="uiEffectStyle"]:checked')?.value || 'none',
      effectIntensity: shared.clamp(value('uiEffectIntensity'), 0, 100),
      optimizeMobile: Boolean(document.getElementById('uiOptimizeMobile')?.checked),
    });
  }

  function updateUiLabels() {
    const pairs = [
      ['uiCardOpacity', 'uiCardOpacityValue', 100, '%'],
      ['uiCardBlur', 'uiCardBlurValue', 32, 'px'],
      ['uiEffectIntensity', 'uiEffectIntensityValue', 100, '%'],
    ];
    pairs.forEach(([inputId, labelId, max, suffix]) => {
      const label = document.getElementById(labelId);
      if (label) label.textContent = `${Math.round(shared.clamp(document.getElementById(inputId)?.value, 0, max))}${suffix}`;
    });
    const custom = document.querySelector('input[name="uiLoginMode"]:checked')?.value === 'custom';
    const row = document.getElementById('uiLoginCustomRow');
    if (row) { row.style.opacity = custom ? '1' : '.52'; row.style.pointerEvents = custom ? 'auto' : 'none'; }
  }

  function previewUi(context) {
    updateUiLabels();
    context.manager.previewSettings(readUiForm());
    shared.setStatus('uiSaveStatus', '', context.vm.t('admin.uiPreviewHint'));
  }

  function bindClear(id, targetId, context) {
    document.getElementById(id)?.addEventListener('click', () => {
      const input = document.getElementById(targetId);
      if (input) input.value = '';
      previewUi(context);
    });
  }

  function bindUiUpload(options) {
    const trigger = document.getElementById(options.triggerId);
    const input = document.getElementById(options.inputId);
    const target = document.getElementById(options.targetId);
    if (!trigger || !input || !target) return;
    trigger.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const loading = options.vm.$message({ message: options.vm.t('admin.uiUploadingBg'), duration: 0 });
      try { target.value = await options.vm.uploadUiDesignBackgroundFile(file); previewUi(options.context); }
      finally { loading.close(); input.value = ''; }
    });
  }

  function bindUiForm(context) {
    const selector = '#uiDesignPanel input';
    document.querySelectorAll(selector).forEach((node) => {
      node.addEventListener('input', () => previewUi(context));
      node.addEventListener('change', () => previewUi(context));
    });
    bindClear('uiClearBrandLogo', 'uiBrandLogoUrl', context);
    bindClear('uiClearGlobalBg', 'uiGlobalBgUrl', context);
    bindClear('uiClearLoginBg', 'uiLoginBgUrl', context);
    const uploads = [['uiUploadBrandBtn','uiUploadBrandInput','uiBrandLogoUrl'], ['uiUploadGlobalBtn','uiUploadGlobalInput','uiGlobalBgUrl'], ['uiUploadLoginBtn','uiUploadLoginInput','uiLoginBgUrl']];
    uploads.forEach(([triggerId, inputId, targetId]) => bindUiUpload({ triggerId, inputId, targetId, vm: context.vm, context }));
    document.getElementById('uiResetDefaults')?.addEventListener('click', () => context.manager.previewSettings(context.defaults));
    previewUi(context);
  }

  async function saveUi(context, instance, done) {
    instance.confirmButtonLoading = true;
    shared.setStatus('uiSaveStatus', 'saving', context.vm.t('admin.uiSaving'));
    try {
      const result = await context.manager.saveToServer(readUiForm());
      if (result?.success !== true) throw new Error(result?.error || 'UI_SETTINGS_SAVE_FAILED');
      shared.setStatus('uiSaveStatus', 'success', context.vm.t('admin.uiSaved'));
      context.vm.$message.success(context.vm.t('admin.uiSavedSyncedMsg', { binding: result.binding || '' }));
      done();
    } catch (error) {
      shared.setStatus('uiSaveStatus', 'warning', error.message);
      context.vm.$message.error(context.vm.t('admin.uiSaveFailed', { msg: error.message }));
    } finally { instance.confirmButtonLoading = false; }
  }

  function openUiDialog(context, html) {
    context.vm.$alert(html, context.vm.t('admin.uiTitle'), {
      customClass: 'ui-design-alert ui-design-footer-actions', dangerouslyUseHTMLString: true,
      showCancelButton: true, closeOnClickModal: false,
      confirmButtonText: context.vm.t('admin.uiSaveSettings'), cancelButtonText: context.vm.t('admin.cancel'),
      beforeClose(action, instance, done) {
        if (action !== 'confirm') { context.manager.restorePersisted(); done(); return; }
        saveUi(context, instance, done);
      },
    });
    context.vm.$nextTick(() => bindUiForm(context));
  }

  async function showUiDesignSettingsPanel() {
    const manager = window.UIDesignManager;
    const required = ['getSettings', 'getDefaults', 'syncFromServer', 'saveToServer', 'previewSettings', 'restorePersisted'];
    if (!manager || required.some((name) => typeof manager[name] !== 'function')) {
      throw new Error('UI_DESIGN_MANAGER_INCOMPLETE');
    }
    const sync = await manager.syncFromServer({ silent: false, applyLocalOnFailure: false });
    if (sync?.success !== true) throw new Error(sync?.error || 'UI_SETTINGS_SYNC_FAILED');
    const context = Object.freeze({ vm: this, manager, defaults: manager.getDefaults() });
    const html = shared.renderTemplate(template, { t: this.t, values: uiValues(manager.getSettings()) });
    openUiDialog(context, html);
  }

  globalThis.LegacyAdminUiDesign = Object.freeze({ showUiDesignSettingsPanel });
}
