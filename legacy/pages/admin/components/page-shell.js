{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.pageShell = `  <div id="app" v-cloak>
    <el-container>
      <el-header>
        <div class="header-content">
          <div class="admin-header-primary">
            <span class="home-btn" @click="goHome"><img src="/logo.png" alt="Seraph's Pictures Logo" class="brand-logo" loading="eager" onerror="this.onerror=null;this.src='/favicon.ico';" /></span>
            <span class="title" @click="refreshDashboard">{{ t('nav.admin') }}</span>
            <div class="search-card"><el-input v-model="search" size="mini" :placeholder="t('admin.searchPlaceholder')"></el-input></div>
          </div>
          <div class="actions admin-header-tools">
            <el-dropdown @command="switchFileType" :hide-on-click="false">
              <span class="el-dropdown-link"><i :class="fileTypeIcon"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="all" :class="{ 'el-dropdown-menu__item--selected': fileType === 'all' }"><i class="fas fa-th-large"></i> {{ t('admin.typeAll') }}</el-dropdown-item>
                <el-dropdown-item command="image" :class="{ 'el-dropdown-menu__item--selected': fileType === 'image' }"><i :class="fileConfig.image.icon"></i> {{ t('admin.typeImage') }}</el-dropdown-item>
                <el-dropdown-item command="video" :class="{ 'el-dropdown-menu__item--selected': fileType === 'video' }"><i :class="fileConfig.video.icon"></i> {{ t('admin.typeVideo') }}</el-dropdown-item>
                <el-dropdown-item command="audio" :class="{ 'el-dropdown-menu__item--selected': fileType === 'audio' }"><i :class="fileConfig.audio.icon"></i> {{ t('admin.typeAudio') }}</el-dropdown-item>
                <el-dropdown-item command="document" :class="{ 'el-dropdown-menu__item--selected': fileType === 'document' }"><i :class="fileConfig.document.icon"></i> {{ t('admin.typeDocument') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
${globalThis.LegacyAdminComponents.profileFilter}
            <el-dropdown @command="switchStorageFilter" :hide-on-click="false">
              <span class="el-dropdown-link"><i :class="storageFilterIcon"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="all" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'all' }"><i class="fas fa-database"></i> {{ t('admin.storageAll') }}</el-dropdown-item>
                <el-dropdown-item command="telegram" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'telegram' }"><i class="fab fa-telegram"></i> Telegram</el-dropdown-item>
                <el-dropdown-item command="r2" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'r2' }"><i class="fas fa-cloud"></i> {{ t('admin.storageR2') }}</el-dropdown-item>
                <el-dropdown-item command="s3" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 's3' }"><i class="fas fa-database"></i> {{ t('admin.storageS3') }}</el-dropdown-item>
                <el-dropdown-item command="discord" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'discord' }"><i class="fab fa-discord"></i> Discord</el-dropdown-item>
                <el-dropdown-item command="huggingface" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'huggingface' }"><i class="fas fa-robot"></i> HuggingFace</el-dropdown-item>
                <el-dropdown-item command="webdav" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'webdav' }"><i class="fas fa-hard-drive"></i> WebDAV</el-dropdown-item>
                <el-dropdown-item command="github" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'github' }"><i class="fab fa-github"></i> GitHub</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="sort" :hide-on-click="false">
              <span class="el-dropdown-link"><i :class="sortIcon"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="dateDesc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'dateDesc' }"><i class="fas fa-sort-amount-down"></i> {{ t('admin.sortDateDesc') }}</el-dropdown-item>
                <el-dropdown-item command="nameAsc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'nameAsc' }"><i class="fas fa-sort-alpha-up"></i> {{ t('admin.sortNameAsc') }}</el-dropdown-item>
                <el-dropdown-item command="sizeDesc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'sizeDesc' }"><i class="fas fa-sort-amount-down"></i> {{ t('admin.sortSizeDesc') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="filter" :hide-on-click="false">
              <span class="el-dropdown-link"><i :class="filterIcon"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="all" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'all' }"><i class="fas fa-filter"></i> {{ t('admin.filterAll') }}</el-dropdown-item>
                <el-dropdown-item command="favorites" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'favorites' }"><i class="fas fa-bookmark"></i> {{ t('admin.filterFavorites') }}</el-dropdown-item>
                <el-dropdown-item command="blocked" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'blocked' }"><i class="fas fa-lock"></i> {{ t('admin.filterBlocked') }}</el-dropdown-item>
                <el-dropdown-item command="unblocked" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'unblocked' }"><i class="fas fa-unlock"></i> {{ t('admin.filterUnblocked') }}</el-dropdown-item>
                <el-dropdown-item command="adult" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'adult' }"><i class="fas fa-user-secret"></i> NSFW</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="switchViewMode" :hide-on-click="false">
              <span class="el-dropdown-link"><i :class="viewModeIcon"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="grid" :class="{ 'el-dropdown-menu__item--selected': viewMode === 'grid' }"><i class="fas fa-th-large"></i> {{ t('admin.viewGrid') }}</el-dropdown-item>
                <el-dropdown-item command="list" :class="{ 'el-dropdown-menu__item--selected': viewMode === 'list' }"><i class="fas fa-list"></i> {{ t('admin.viewList') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="handleBatchOperation" :hide-on-click="false">
              <span class="el-dropdown-link"><i class="fas fa-tasks"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="selectAll"><i class="fas fa-check-double"></i> {{ isAllSelected ? t('admin.batchUnselectAll') : t('admin.batchSelectAll') }}</el-dropdown-item>
                <el-dropdown-item command="selectAllLoaded"><i class="fas fa-check-square"></i> {{ t('admin.batchSelectLoaded') }} ({{ tableData.length }})</el-dropdown-item>
                <el-dropdown-item divided command="copy" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-link"></i> {{ t('admin.batchCopy') }}</el-dropdown-item>
                <el-dropdown-item command="copyMarkdown" :class="{ disabled: selectedFiles.length === 0 }"><i class="fab fa-markdown"></i> {{ t('admin.batchCopyMarkdown') }}</el-dropdown-item>
                <el-dropdown-item command="copyHtml" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-code"></i> {{ t('admin.batchCopyHtml') }}</el-dropdown-item>
                <el-dropdown-item command="delete" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-trash-alt"></i> {{ t('admin.batchDelete') }}</el-dropdown-item>
                <el-dropdown-item command="download" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-download"></i> {{ t('admin.batchDownload') }}</el-dropdown-item>
                <el-dropdown-item command="moveFolder" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-folder-tree"></i> {{ t('admin.batchMoveFolder') }}</el-dropdown-item>
                <el-dropdown-item command="block" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-lock"></i> {{ t('admin.batchBlock') }}</el-dropdown-item>
                <el-dropdown-item command="unblock" :class="{ disabled: selectedFiles.length === 0 }"><i class="fas fa-unlock"></i> {{ t('admin.batchUnblock') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="handleToolkit" :hide-on-click="false">
              <span class="el-dropdown-link"><i class="fas fa-toolbox"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="selectAllInPage"><i class="fas fa-check-square"></i> {{ t('admin.toolkitSelectAllInPage') }}</el-dropdown-item>
                <el-dropdown-item command="checkBrokenFiles"><i class="fas fa-wrench"></i> {{ t('admin.toolkitCheckBroken') }}</el-dropdown-item>
                <el-dropdown-item command="openUploader"><i class="fas fa-cloud-upload-alt"></i> {{ t('admin.toolkitOpenUploader') }}</el-dropdown-item>
                <el-dropdown-item command="exportLinks"><i class="fas fa-file-export"></i> {{ t('admin.toolkitExportLinks') }}</el-dropdown-item>
                <el-dropdown-item command="manageApiTokens"><i class="fas fa-key"></i> {{ t('admin.toolkitManageTokens') }}</el-dropdown-item>
                <el-dropdown-item command="checkStatus" divided><i class="fas fa-heartbeat"></i> {{ t('admin.toolkitCheckStatus') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown @command="handleLoadSettings" :hide-on-click="false">
              <span class="el-dropdown-link"><i class="fas fa-cog"></i></span>
              <el-dropdown-menu slot="dropdown">
                <el-dropdown-item command="normal" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'normal' }"><i class="fas fa-eye"></i> {{ t('admin.loadNormal') }}</el-dropdown-item>
                <el-dropdown-item command="dataSaver" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'dataSaver' }"><i class="fas fa-bolt"></i> {{ t('admin.loadDataSaver') }}</el-dropdown-item>
                <el-dropdown-item command="noImage" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'noImage' }"><i class="fas fa-eye-slash"></i> {{ t('admin.loadNoImage') }}</el-dropdown-item>
                <el-dropdown-item command="safeMode" divided :class="{ 'el-dropdown-menu__item--selected': safeMode }"><i class="fas fa-shield-alt"></i> {{ safeMode ? '✓' : '' }} {{ t('admin.safeModeMenu') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
          </div>
          <div class="admin-header-system">
            <el-tooltip :content="t('admin.tooltipStorage')" placement="bottom"><i class="fas fa-server" @click="showStorageConfigPanel"></i></el-tooltip>
            <el-tooltip :content="t('admin.tooltipStorageConfig')" placement="bottom"><i class="fas fa-database" @click="openStorageSettings"></i></el-tooltip>
            <el-tooltip :content="t('admin.tooltipUiDesign')" placement="bottom"><i class="fas fa-sliders-h" @click="showUiDesignSettingsPanel"></i></el-tooltip>
            <el-tooltip :content="t('admin.tooltipGuestUpload')" placement="bottom"><i class="fas fa-user-shield" @click="showGuestSettingsPanel"></i></el-tooltip>
            <el-tooltip :content="t('admin.tooltipAccount')" placement="bottom"><i class="fas fa-user-cog" @click="showAccountSecurityPanel"></i></el-tooltip>
            <button type="button" class="admin-theme-btn admin-lang-btn" data-i18n-toggle aria-label="切换语言">
              <span data-lang-label>EN</span>
            </button>
            <button type="button" class="admin-theme-btn" data-theme-toggle :title="t('admin.tooltipTheme')">
              <i class="fas fa-moon" data-theme-icon></i>
            </button>
            <i class="fas fa-sign-out-alt" @click="handleLogout"></i>
          </div>
        </div>
      </el-header>
      <el-main class="main-container">`;
}
