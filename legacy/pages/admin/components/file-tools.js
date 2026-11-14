{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.fileTools = `          <section class="admin-file-tools" :aria-label="t('admin.fileTools')">
            <div class="admin-file-search">
              <label class="admin-sr-only" for="admin-file-search">{{ t('admin.searchPlaceholder') }}</label>
              <i class="fas fa-search" aria-hidden="true"></i>
              <input id="admin-file-search" type="search" v-model="search" :placeholder="t('admin.searchPlaceholder')" autocomplete="off">
              <button type="button" class="admin-tool-button" @click="refreshFileList({ syncFolders: true })" :aria-label="t('admin.refresh')" :title="t('admin.refresh')"><i class="fas fa-sync-alt" aria-hidden="true"></i></button>
            </div>
            <div class="admin-file-controls">
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu1', $event)" @command="switchFileType" data-file-tool="switchFileType">
              <button ref="navMenu1" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i :class="fileTypeIcon"></i><span>{{ t('admin.fileCategory') + ': ' + t('admin.type' + fileType.charAt(0).toUpperCase() + fileType.slice(1)) }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="all" :class="{ 'el-dropdown-menu__item--selected': fileType === 'all' }"><i class="fas fa-th-large"></i> {{ t('admin.typeAll') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="image" :class="{ 'el-dropdown-menu__item--selected': fileType === 'image' }"><i :class="fileConfig.image.icon"></i> {{ t('admin.typeImage') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="video" :class="{ 'el-dropdown-menu__item--selected': fileType === 'video' }"><i :class="fileConfig.video.icon"></i> {{ t('admin.typeVideo') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="audio" :class="{ 'el-dropdown-menu__item--selected': fileType === 'audio' }"><i :class="fileConfig.audio.icon"></i> {{ t('admin.typeAudio') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="document" :class="{ 'el-dropdown-menu__item--selected': fileType === 'document' }"><i :class="fileConfig.document.icon"></i> {{ t('admin.typeDocument') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu2', $event)" @command="switchStorageFilter" data-file-tool="switchStorageFilter">
              <button ref="navMenu2" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i :class="storageFilterIcon"></i><span>{{ storageFilter === 'all' ? t('admin.storageKind') : storageFilter }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="all" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'all' }"><i class="fas fa-boxes"></i> {{ t('admin.storageAll') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="telegram" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'telegram' }"><i class="fab fa-telegram"></i> Telegram</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="r2" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'r2' }"><i class="fas fa-cloud"></i> {{ t('admin.storageR2') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="s3" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 's3' }"><i class="fas fa-database"></i> {{ t('admin.storageS3') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="discord" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'discord' }"><i class="fab fa-discord"></i> Discord</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="huggingface" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'huggingface' }"><i class="fas fa-robot"></i> HuggingFace</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="webdav" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'webdav' }"><i class="fas fa-hard-drive"></i> WebDAV</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="github" :class="{ 'el-dropdown-menu__item--selected': storageFilter === 'github' }"><i class="fab fa-github"></i> GitHub</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
${globalThis.LegacyAdminComponents.profileFilter}
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu3', $event)" @command="sort" data-file-tool="sort">
              <button ref="navMenu3" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i :class="sortIcon"></i><span>{{ t('admin.sort' + sortOption.charAt(0).toUpperCase() + sortOption.slice(1)) }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="dateDesc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'dateDesc' }"><i class="fas fa-sort-numeric-down"></i> {{ t('admin.sortDateDesc') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="nameAsc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'nameAsc' }"><i class="fas fa-sort-alpha-up"></i> {{ t('admin.sortNameAsc') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="sizeDesc" :class="{ 'el-dropdown-menu__item--selected': sortOption === 'sizeDesc' }"><i class="fas fa-sort-amount-down"></i> {{ t('admin.sortSizeDesc') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu4', $event)" @command="filter" data-file-tool="filter">
              <button ref="navMenu4" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i :class="filterIcon"></i><span>{{ filterOption === 'all' ? t('admin.filterLabel') : t('admin.filter' + filterOption.charAt(0).toUpperCase() + filterOption.slice(1)) }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="all" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'all' }"><i class="fas fa-filter"></i> {{ t('admin.filterAll') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="favorites" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'favorites' }"><i class="fas fa-bookmark"></i> {{ t('admin.filterFavorites') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="blocked" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'blocked' }"><i class="fas fa-lock"></i> {{ t('admin.filterBlocked') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="unblocked" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'unblocked' }"><i class="fas fa-unlock"></i> {{ t('admin.filterUnblocked') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="adult" :class="{ 'el-dropdown-menu__item--selected': filterOption === 'adult' }"><i class="fas fa-user-secret"></i> NSFW</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <div class="admin-view-switch" role="group" :aria-label="t('admin.viewLabel')">
              <button type="button" class="admin-tool-button" :aria-pressed="viewMode === 'grid'" @click="switchViewMode('grid')" :aria-label="t('admin.viewGrid')" :title="t('admin.viewGrid')"><i class="fas fa-th" aria-hidden="true"></i></button>
              <button type="button" class="admin-tool-button" :aria-pressed="viewMode === 'list'" @click="switchViewMode('list')" :aria-label="t('admin.viewList')" :title="t('admin.viewList')"><i class="fas fa-list" aria-hidden="true"></i></button>
            </div>
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu5', $event)" @command="handleBatchOperation" data-file-tool="handleBatchOperation">
              <button ref="navMenu5" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i class="fas fa-tasks"></i><span>{{ t('admin.batchLabel') + (selectedFiles.length ? ' (' + selectedFiles.length + ')' : '') }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="selectAll"><i class="fas fa-check-double"></i> {{ isAllSelected ? t('admin.batchUnselectAll') : t('admin.batchSelectAll') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="selectAllLoaded"><i class="fas fa-check-square"></i> {{ t('admin.batchSelectLoaded') }} ({{ tableData.length }})</el-dropdown-item>
                <el-dropdown-item role="menuitem" divided command="copy" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-link"></i> {{ t('admin.batchCopy') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="copyMarkdown" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fab fa-markdown"></i> {{ t('admin.batchCopyMarkdown') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="copyHtml" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-code"></i> {{ t('admin.batchCopyHtml') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="delete" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-trash-alt"></i> {{ t('admin.batchDelete') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="download" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-download"></i> {{ t('admin.batchDownload') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="moveFolder" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-folder-tree"></i> {{ t('admin.batchMoveFolder') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="block" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-lock"></i> {{ t('admin.batchBlock') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="unblock" :disabled="selectedFiles.length === 0" :aria-disabled="String(selectedFiles.length === 0)"><i class="fas fa-unlock"></i> {{ t('admin.batchUnblock') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu6', $event)" @command="handleToolkit" data-file-tool="handleToolkit">
              <button ref="navMenu6" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i class="fas fa-toolbox"></i><span>{{ t('admin.moreActions') }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="checkBrokenFiles"><i class="fas fa-wrench"></i> {{ t('admin.toolkitCheckBroken') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="exportLinks"><i class="fas fa-file-export"></i> {{ t('admin.toolkitExportLinks') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            <el-dropdown trigger="click" @visible-change="setNavigationMenuExpanded('navMenu7', $event)" @command="handleLoadSettings" data-file-tool="handleLoadSettings">
              <button ref="navMenu7" type="button" aria-haspopup="menu" aria-expanded="false" class="admin-tool-button"><i class="fas fa-sliders-h"></i><span>{{ t('admin.displayLabel') }}</span><i class="el-icon-arrow-down" aria-hidden="true"></i></button>
              <el-dropdown-menu role="menu" slot="dropdown">
                <el-dropdown-item role="menuitem" command="normal" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'normal' }"><i class="fas fa-eye"></i> {{ t('admin.loadNormal') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="dataSaver" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'dataSaver' }"><i class="fas fa-bolt"></i> {{ t('admin.loadDataSaver') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="noImage" :class="{ 'el-dropdown-menu__item--selected': loadMode === 'noImage' }"><i class="fas fa-eye-slash"></i> {{ t('admin.loadNoImage') }}</el-dropdown-item>
                <el-dropdown-item role="menuitem" command="safeMode" divided :class="{ 'el-dropdown-menu__item--selected': safeMode }"><i class="fas fa-shield-alt"></i> {{ safeMode ? '✓' : '' }} {{ t('admin.safeModeMenu') }}</el-dropdown-item>
              </el-dropdown-menu>
            </el-dropdown>
            </div>
          </section>`;
}
