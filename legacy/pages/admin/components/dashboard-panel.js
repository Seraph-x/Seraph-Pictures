{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.dashboardPanel = `        <div class="disk-layout" :class="{ 'is-list-view': viewMode === 'list' }">
          <aside class="folder-sidebar">
            <div class="folder-stats" role="status" aria-live="polite">
              <i class="fas fa-chart-line"></i>
              <span>{{ t('admin.totalRecords') }} {{ totalCount || Number }}</span>
              <small>{{ t('admin.loadedCount') }} {{ Number }}</small>
            </div>
            <div class="folder-head">
              <span class="folder-head-title"><i class="fas fa-folder-tree"></i><span>{{ t('admin.folderManage') }}</span></span>
              <span class="folder-head-actions">
                <el-button size="mini" circle icon="el-icon-refresh" :title="t('admin.refreshFolders')" :disabled="folderMutating" :loading="folderLoading" @click="refreshFolderResources"></el-button>
                <el-button size="mini" circle icon="el-icon-plus" :title="t('admin.createFolderTitle')" :disabled="folderMutating" :loading="folderMutatingAction === 'create'" @click="createFolder"></el-button>
                <el-button size="mini" circle icon="el-icon-edit" :title="t('admin.renameFolderTitle')" :disabled="folderMutating || !folderPath" :loading="folderMutatingAction === 'rename'" @click="renameCurrentFolder"></el-button>
                <el-button size="mini" circle icon="el-icon-delete" :title="t('admin.deleteFolderTitle')" :disabled="folderMutating || !folderPath" :loading="folderMutatingAction === 'delete'" @click="deleteCurrentFolder"></el-button>
              </span>
            </div>
            <div class="folder-current">{{ t('admin.currentLocation') }}/{{ folderPath || '' }}</div>
            <div class="folder-tree">
              <button
                v-for="folder in folderTreeNodes"
                :key="'folder-' + folder.path"
                class="folder-node"
                :class="{ 'is-active': folder.path === folderPath, 'is-drop-target': dragState.active && dragState.targetPath === folder.path }"
                @click="selectFolder(folder.path)"
                @dragover.prevent="handleFolderDragOver(folder.path, $event)"
                @dragenter.prevent="handleFolderDragEnter(folder.path)"
                @dragleave="handleFolderDragLeave(folder.path, $event)"
                @drop.prevent="handleFolderDrop(folder.path, $event)"
              >
                <span class="folder-node-main" :style="{ paddingLeft: (folder.depth * 14 + 6) + 'px' }">
                  <i class="fas" :class="folder.path === folderPath ? 'fa-folder-open' : 'fa-folder'"></i>
                  <span>{{ folder.name }}</span>
                </span>
                <span class="folder-node-count">{{ folder.fileCount }}</span>
              </button>
            </div>
          </aside>
          <section class="disk-content" :class="{ 'is-list-view': viewMode === 'list' }">
            <div class="folder-breadcrumb">
              <i class="fas fa-location-arrow"></i>
              <span class="folder-crumb" @click="selectFolder('')">{{ t('admin.rootDir') }}</span>
              <template v-for="item in folderBreadcrumbs">
                <i :key="'sep-' + item.path" class="el-icon-arrow-right"></i>
                <span :key="'crumb-' + item.path" class="folder-crumb" @click="selectFolder(item.path)">{{ item.name }}</span>
              </template>
            </div>`;
}
