{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.pageHeader = `    <div id="app" v-cloak>
      <!-- 头部导航 -->
      <div class="header">
        <div class="header-title">
          <img
            src="/logo.png"
            alt="Seraph's Pictures Logo"
            class="brand-logo"
            loading="eager"
            data-brand-home="1"
            @click.stop="handleBrandLogoClick"
            onerror="this.onerror=null;this.src='/favicon.ico';"
          />
          <span class="brand-name">Seraph's Pictures</span>
        </div>
        <div class="nav-links">
          <a href="./" class="nav-link is-active" aria-current="page"><i class="fas fa-home"></i> {{ t('nav.home') }}</a>
          <a href="/gallery" v-if="!isGuest"
            ><i class="fas fa-images"></i> {{ t('nav.gallery') }}</a
          >
          <a href="/webdav" v-if="!isGuest"
            ><i class="fas fa-hard-drive"></i> {{ t('nav.webdav') }}</a
          >
          <a href="/admin" v-if="!isGuest"
            ><i class="fas fa-cog"></i> {{ t('nav.admin') }}</a
          >
        </div>
        <button type="button" class="theme-toggle-btn header-theme-toggle theme-icon-only" data-i18n-toggle aria-label="切换语言">
          <span data-lang-label>EN</span>
        </button>
        <button type="button" class="theme-toggle-btn header-theme-toggle theme-icon-only" data-theme-toggle aria-label="切换主题">
          <i class="fas fa-moon" data-theme-icon></i>
        </button>
      </div>

      <!-- 访客模式提示条 -->
      <div class="guest-notice" v-if="!authChecking && isGuest && guestUploadConfig">
        <i class="fas fa-user-clock"></i>
        <span
          >{{ t('guest.notice1') }} {{ formatSize(guestUploadConfig.maxFileSize)
          }}{{ t('guest.notice2') }} {{ guestUploadConfig.maxDailyUploads }} {{ t('guest.notice3') }}</span
        >
      </div>
`;
}
