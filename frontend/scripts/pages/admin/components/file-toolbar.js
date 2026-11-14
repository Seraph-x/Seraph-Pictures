{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.fileToolbar = `    <!-- 底部悬浮批量操作栏 -->
    <transition name="batch-float">
      <div class="batch-toolbar"
           v-if="selectedFiles.length > 0"
           ref="batchToolbar"
           @mousedown.stop="startBatchDrag"
           :class="{ 'is-dragging': batchDragState.dragging }"
           :style="batchToolbarStyle">
        <span class="batch-count">{{ t('admin.selectedN', { n: selectedFiles.length }) }}</span>
${globalThis.LegacyAdminComponents.migrationDialog}
        <el-button-group size="mini" class="batch-actions">
          <el-button class="batch-btn batch-btn-copy" icon="el-icon-document-copy" @click="handleBatchCopy">{{ t('admin.copyLink') }}</el-button>
          <el-button class="batch-btn batch-btn-move" icon="el-icon-folder-opened" @click="moveSelectedToFolder">{{ t('admin.moveFolder') }}</el-button>
          <el-button class="batch-btn batch-btn-delete" icon="el-icon-delete" @click="handleBatchDelete">{{ t('admin.delete') }}</el-button>
          <el-button class="batch-btn batch-btn-download" icon="el-icon-download" @click="handleBatchDownload">{{ t('admin.download') }}</el-button>
        </el-button-group>
        <el-button class="batch-btn batch-btn-cancel" icon="el-icon-close" @click="clearSelection">{{ t('admin.cancelSelect') }}</el-button>
        <span class="batch-shortcuts">{{ t('admin.shortcuts') }}</span>
      </div>
    </transition>
  </div>`;
}
