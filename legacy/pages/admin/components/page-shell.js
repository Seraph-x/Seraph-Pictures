{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.pageShell = `  <div id="app" class="admin-workspace" v-cloak>
    <el-container>
      <el-header>
        <div class="header-content admin-navigation">
          <a class="admin-brand" href="/" :aria-label="t('nav.home')">
            <img src="/logo.png" alt="" width="32" height="32">
            <span>Seraph's Pictures</span>
          </a>
          <nav class="admin-primary-nav" :aria-label="t('admin.primaryNavigation')">
            <a href="/"><i class="fas fa-cloud-upload-alt" aria-hidden="true"></i>{{ t('admin.uploadLabel') }}</a>
            <a href="/gallery"><i class="fas fa-images" aria-hidden="true"></i>{{ t('nav.gallery') }}</a>
            <a href="/webdav"><i class="fas fa-hard-drive" aria-hidden="true"></i>{{ t('nav.webdav') }}</a>
            <a href="/admin" aria-current="page"><i class="fas fa-folder-open" aria-hidden="true"></i>{{ t('admin.filesLabel') }}</a>
          </nav>
          <div class="admin-header-system">
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenuSystem', $event)" @command="(cmd) => {
              if (cmd === 'storageStatus') showStorageConfigPanel();
              else if (cmd === 'storageConfig') openStorageSettings();
              else if (cmd === 'modifyUi') showUiDesignSettingsPanel();
              else if (cmd === 'guestSettings') showGuestSettingsPanel();
              else if (cmd === 'accountSettings') showAccountSecurityPanel();
              else if (cmd === 'apiTokens') openApiTokenDialog();
            }">
              <button ref="navMenuSystem" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-nav-button" :aria-label="t('admin.tooltipSystemSettings')" :title="t('admin.tooltipSystemSettings')">
                <i class="fas fa-cog" aria-hidden="true"></i><span class="admin-system-label">{{ t('admin.settingsLabel') }}</span>
              </button>
              <el-dropdown-menu role="menu" slot="dropdown" class="system-settings-dropdown-menu">
                <el-dropdown-item role="menuitem" command="storageStatus"><i class="fas fa-server"></i> {{ t('admin.tooltipStorage') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="storageConfig"><i class="fas fa-database"></i> {{ t('admin.tooltipStorageConfig') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="modifyUi"><i class="fas fa-sliders-h"></i> {{ t('admin.tooltipUiDesign') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="guestSettings"><i class="fas fa-user-shield"></i> {{ t('admin.tooltipGuestUpload') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="apiTokens"><i class="fas fa-key"></i> {{ t('admin.toolkitManageTokens') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="accountSettings"><i class="fas fa-user-cog"></i> {{ t('admin.tooltipAccount') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <button type="button" class="admin-nav-button admin-lang-btn" data-i18n-toggle :aria-label="t('admin.languageLabel')">
              <span data-lang-label>EN</span>
            </button>
            <button type="button" class="admin-nav-button" data-theme-toggle :title="t('admin.tooltipTheme')" :aria-label="t('admin.tooltipTheme')">
              <i class="fas fa-moon" data-theme-icon></i>
            </button>
            <button type="button" class="admin-nav-button" @click="handleLogout" :aria-label="t('admin.logoutLabel')" :title="t('admin.logoutLabel')"><i class="fas fa-sign-out-alt" aria-hidden="true"></i></button>
          </div>
        </div>
      </el-header>
      <el-main class="main-container">`;
}
