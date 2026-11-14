{
  'use strict';

  const UI_DESIGN_TEMPLATE = `
<div class="ui-design-panel" id="uiDesignPanel">
  <div class="ui-design-head"><div>
    <div class="ui-design-title"><i class="fas fa-palette"></i><span>{{t:admin.uiTitle}}</span></div>
    <div class="ui-design-subtitle">{{t:admin.uiSubtitle}}</div>
  </div></div>
  <section class="ui-design-section">
    <div class="ui-design-section-title"><i class="fas fa-bookmark"></i> {{t:admin.uiBrandSectionTitle}}</div>
    <div class="ui-design-inline"><input id="uiBrandName" class="ui-design-input" value="{{v:brandName}}" placeholder="{{t:admin.uiBrandNamePlaceholder}}"></div>
    <div class="ui-design-inline"><input id="uiBrandLogoUrl" class="ui-design-input" value="{{v:brandLogoUrl}}" placeholder="{{t:admin.uiBrandLogoPlaceholder}}"></div>
    <div class="ui-design-inline ui-design-action-grid">
      <button type="button" id="uiUploadBrandBtn" class="ui-upload-drop"><i class="fas fa-cloud-upload-alt"></i><span>{{t:admin.uiUploadIcon}}</span></button>
      <input id="uiUploadBrandInput" type="file" accept="image/*" hidden>
      <button type="button" id="uiClearBrandLogo" class="el-button el-button--small">{{t:admin.uiClear}}</button>
    </div>
  </section>
  <section class="ui-design-section">
    <div class="ui-design-section-title"><i class="fas fa-image"></i> {{t:admin.uiBgSectionTitle}}</div>
    <div class="ui-design-inline"><input id="uiGlobalBgUrl" class="ui-design-input" value="{{v:globalBackgroundUrl}}" placeholder="{{t:admin.uiBgUrlPlaceholder}}"></div>
    <div class="ui-design-inline ui-design-action-grid">
      <button type="button" id="uiUploadGlobalBtn" class="ui-upload-drop">{{t:admin.uiUploadImage}}</button>
      <input id="uiUploadGlobalInput" type="file" accept="image/*" hidden>
      <button type="button" id="uiClearGlobalBg" class="el-button el-button--small">{{t:admin.uiClear}}</button>
    </div>
  </section>
  <section class="ui-design-section">
    <div class="ui-design-section-title"><i class="fas fa-sign-in-alt"></i> {{t:admin.uiLoginSectionTitle}}</div>
    <div class="ui-segmented ui-design-equal-options">
      <label class="ui-segment"><input type="radio" name="uiLoginMode" value="follow-global" {{v:followGlobal}}><span>{{t:admin.uiLoginFollowGlobal}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiLoginMode" value="custom" {{v:customLogin}}><span>{{t:admin.uiLoginCustom}}</span></label>
    </div>
    <div class="ui-design-inline ui-design-login-grid" id="uiLoginCustomRow">
      <input id="uiLoginBgUrl" class="ui-design-input" value="{{v:loginBackgroundUrl}}" placeholder="{{t:admin.uiLoginUrlPlaceholder}}">
      <button type="button" id="uiUploadLoginBtn" class="ui-upload-drop">{{t:admin.uiUploadImage}}</button>
      <input id="uiUploadLoginInput" type="file" accept="image/*" hidden>
      <button type="button" id="uiClearLoginBg" class="el-button el-button--small">{{t:admin.uiClear}}</button>
    </div>
  </section>
  <section class="ui-design-section">
    <div class="ui-design-section-title"><i class="fas fa-clone"></i> {{t:admin.uiOpacitySectionTitle}}</div>
    <div class="ui-design-range-wrap"><div class="ui-design-range-head"><span>{{t:admin.uiCardOpacity}}</span><span id="uiCardOpacityValue"></span></div><input id="uiCardOpacity" class="ui-design-range" type="range" min="0" max="100" value="{{v:cardOpacity}}"></div>
    <div class="ui-design-range-wrap"><div class="ui-design-range-head"><span>{{t:admin.uiCardBlur}}</span><span id="uiCardBlurValue"></span></div><input id="uiCardBlur" class="ui-design-range" type="range" min="0" max="32" value="{{v:cardBlur}}"></div>
  </section>
  <section class="ui-design-section">
    <div class="ui-design-section-title"><i class="fas fa-wave-square"></i> {{t:admin.uiEffectSectionTitle}}</div>
    <div class="ui-segmented ui-effect-grid">
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="none" {{v:effectNone}}><span>{{t:admin.uiEffectNone}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="feather" {{v:effectFeather}}><span>{{t:admin.uiEffectFeather}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="dandelion" {{v:effectDandelion}}><span>{{t:admin.uiEffectDandelion}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="petal" {{v:effectPetal}}><span>{{t:admin.uiEffectPetal}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="snow" {{v:effectSnow}}><span>{{t:admin.uiEffectSnow}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="firefly" {{v:effectFirefly}}><span>{{t:admin.uiEffectFirefly}}</span></label>
      <label class="ui-segment"><input type="radio" name="uiEffectStyle" value="texture" {{v:effectTexture}}><span>{{t:admin.uiEffectTexture}}</span></label>
    </div>
    <div class="ui-design-range-wrap"><div class="ui-design-range-head"><span>{{t:admin.uiEffectIntensity}}</span><span id="uiEffectIntensityValue"></span></div><input id="uiEffectIntensity" class="ui-design-range" type="range" min="0" max="100" value="{{v:effectIntensity}}"></div>
    <label class="ui-design-inline"><input id="uiOptimizeMobile" type="checkbox" {{v:optimizeMobile}}><span>{{t:admin.uiOptimizeMobile}}</span></label>
  </section>
  <div class="ui-design-foot ui-design-reset-foot"><button type="button" id="uiResetDefaults" class="el-button el-button--small">{{t:admin.uiResetDefaults}}</button><span id="uiSaveStatus" class="ui-design-save-status"></span></div>
</div>`;

  const ACCOUNT_TEMPLATE = `
<div class="ui-design-panel" id="accountSecurityPanel">
  <div class="ui-design-head"><div><div class="ui-design-title"><i class="fas fa-user-cog"></i><span>{{t:admin.accountPanelTitle}}</span></div><div class="ui-design-subtitle">{{t:admin.accountSubtitle}}</div></div></div>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.accountCurrentUserLabel}}</div><div class="ui-design-inline"><strong>{{v:username}}</strong></div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.accountNewUsernameLabel}}</div><input id="accNewUsername" class="ui-design-input" autocomplete="username" value="{{v:username}}" placeholder="{{t:admin.accountNewUsernamePh}}"></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.accountCurrentPasswordLabel}}</div><div class="acc-pass-field"><input id="accCurrentPassword" class="ui-design-input" type="password" autocomplete="current-password" placeholder="{{t:admin.accountCurrentPasswordPh}}"><button type="button" class="acc-pass-toggle" data-toggle-for="accCurrentPassword"><i class="fas fa-eye"></i></button></div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.accountNewPasswordLabel}}</div><div class="acc-pass-field"><input id="accNewPassword" class="ui-design-input" type="password" autocomplete="new-password" placeholder="{{t:admin.accountNewPasswordPh}}"><button type="button" class="acc-pass-toggle" data-toggle-for="accNewPassword"><i class="fas fa-eye"></i></button></div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.accountNewPasswordConfirmLabel}}</div><div class="acc-pass-field"><input id="accNewPassword2" class="ui-design-input" type="password" autocomplete="new-password" placeholder="{{t:admin.accountNewPasswordConfirmPh}}"><button type="button" class="acc-pass-toggle" data-toggle-for="accNewPassword2"><i class="fas fa-eye"></i></button></div></section>
  <div class="ui-design-foot acc-foot-center"><span id="accSaveStatus" class="ui-design-save-status"></span></div>
  <section class="ui-design-section"><div class="ui-design-section-title"><i class="fas fa-fingerprint"></i> {{t:admin.accountPasskeyTitle}}</div><div class="ui-design-tip">{{t:admin.accountPasskeyTip}}</div><div id="accPasskeyList" class="acc-passkey-list"></div><button type="button" id="accPasskeyRegister" class="acc-passkey-btn"><i class="fas fa-plus"></i> {{t:admin.accountPasskeyRegister}}</button><span id="accPasskeyStatus" class="ui-design-save-status"></span></section>
</div>`;

  const GUEST_TEMPLATE = `
<div class="ui-design-panel" id="guestSettingsPanel">
  <div class="ui-design-head"><div><div class="ui-design-title"><i class="fas fa-user-shield"></i><span>{{t:admin.guestPanelTitle}}</span></div><div class="ui-design-subtitle">{{t:admin.guestSubtitle}}</div></div></div>
  <section class="ui-design-section"><label class="ui-design-inline"><input id="guestEnabled" type="checkbox" {{v:enabled}}><span>{{t:admin.guestEnableLabel}}</span></label><div class="ui-design-tip">{{t:admin.guestEnableTip}}</div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.guestRetentionTitle}}</div><div class="ui-design-inline"><input id="guestRetentionDays" class="ui-design-input" type="number" min="0" value="{{v:retentionDays}}"><span>{{t:admin.guestRetentionUnit}}</span></div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.guestDailyLimitTitle}}</div><div class="ui-design-inline"><input id="guestDailyLimit" class="ui-design-input" type="number" min="0" max="1000" value="{{v:dailyLimit}}"><span>{{t:admin.guestDailyLimitUnit}}</span></div></section>
  <section class="ui-design-section"><div class="ui-design-section-title">{{t:admin.guestMaxFileSizeTitle}}</div><div class="ui-design-inline"><input id="guestMaxFileSize" class="ui-design-input" type="number" min="0" max="20" step="0.5" value="{{v:maxFileSize}}"><span>{{t:admin.guestMaxFileSizeUnit}}</span></div></section>
  <div class="ui-design-foot"><span id="guestSaveStatus" class="ui-design-save-status"></span></div>
</div>`;

  globalThis.LegacyAdminSettingsTemplates = Object.freeze({
    account: ACCOUNT_TEMPLATE, guest: GUEST_TEMPLATE, uiDesign: UI_DESIGN_TEMPLATE,
  });
}
