{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.folderMoveDialog = `    <el-dialog
      :title="t('admin.moveFilesTitle')"
      :visible.sync="folderMoveDialogVisible"
      width="520px"
      append-to-body
      :before-close="closeFolderMoveDialog"
      :close-on-click-modal="!folderMovePending"
      :close-on-press-escape="!folderMovePending"
      :show-close="!folderMovePending"
      custom-class="folder-move-dialog">
      <p>{{ t('admin.moveFolderDestinationHint') }}</p>
      <el-autocomplete
        v-model="folderMoveTarget"
        :fetch-suggestions="queryFolderMoveSuggestions"
        :placeholder="t('admin.moveFolderDestinationPlaceholder')"
        style="width:100%;"
        @select="selectFolderMoveSuggestion">
        <template slot-scope="{ item }"><span>{{ item.label }}</span></template>
      </el-autocomplete>
      <span slot="footer" class="dialog-footer">
        <el-button :disabled="folderMovePending" @click="closeFolderMoveDialog()">
          {{ t('admin.cancel') }}
        </el-button>
        <el-button type="primary" :loading="folderMovePending" @click="confirmFolderMove">
          {{ t('admin.confirmMove') }}
        </el-button>
      </span>
    </el-dialog>`;
}
