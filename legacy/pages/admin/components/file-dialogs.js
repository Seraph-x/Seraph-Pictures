{
  'use strict';
  globalThis.LegacyAdminComponents = globalThis.LegacyAdminComponents || {};
  globalThis.LegacyAdminComponents.fileDialogs = `    <el-dialog
      :title="t('admin.tokenDialogTitle')"
      :visible.sync="tokenDialogVisible"
      width="860px"
      custom-class="token-manager-dialog">
      <div class="token-toolbar">
        <el-button size="mini" type="primary" icon="el-icon-plus" @click="openCreateTokenDialog">{{ t('admin.tokenNew') }}</el-button>
        <el-button size="mini" icon="el-icon-refresh" :loading="tokenLoading" @click="loadApiTokens">{{ t('admin.refresh') }}</el-button>
      </div>
      <div v-if="tokenLoading" class="token-loading">
        <i class="el-icon-loading"></i> {{ t('admin.tokenLoading') }}
      </div>
      <div v-else-if="apiTokens.length === 0" class="token-empty">
        <i class="fas fa-key"></i>
        <p>{{ t('admin.tokenEmpty') }}</p>
      </div>
      <el-table
        v-else
        :data="apiTokens"
        stripe
        border
        size="mini"
        row-key="id">
        <el-table-column prop="name" :label="t('admin.colName')" min-width="170"></el-table-column>
        <el-table-column :label="t('admin.colScopes')" min-width="190">
          <template slot-scope="scope">
            <el-tag
              v-for="scopeName in scope.row.scopes"
              :key="scope.row.id + '-' + scopeName"
              size="mini"
              :type="tokenScopeTagType(scopeName)"
              class="token-scope-tag">
              {{ scopeName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.colCreatedAt')" min-width="140">
          <template slot-scope="scope">
            <div>{{ formatDateTime(scope.row.createdAt) }}</div>
            <small class="token-time-hint">{{ formatRelativeTime(scope.row.createdAt) }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.colLastUsed')" min-width="140">
          <template slot-scope="scope">
            <span v-if="scope.row.lastUsedAt">{{ formatRelativeTime(scope.row.lastUsedAt) }}</span>
            <span v-else class="token-time-hint">{{ t('admin.neverUsed') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.colTokenPreview')" min-width="122">
          <template slot-scope="scope">
            <code>{{ scope.row.tokenPreview }}</code>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.colStatus')" width="176" align="center">
          <template slot-scope="scope">
            <el-switch
              v-model="scope.row.enabled"
              :disabled="Boolean(tokenMutatingMap[scope.row.id])"
              active-color="#13ce66"
              inactive-color="#ff6b6b"
              @change="toggleApiTokenEnabled(scope.row)">
            </el-switch>
            <span class="token-status-text" :class="{ 'is-enabled': scope.row.enabled }">
              {{ scope.row.enabled ? t('admin.enabled') : t('admin.disabled') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.colActions')" width="86" align="center">
          <template slot-scope="scope">
            <el-button
              type="text"
              style="color:#f56c6c"
              :disabled="Boolean(tokenMutatingMap[scope.row.id])"
              @click="removeApiToken(scope.row)">
              {{ t('admin.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog
      :title="t('admin.createTokenTitle')"
      :visible.sync="createTokenDialogVisible"
      width="560px"
      append-to-body
      custom-class="token-create-dialog">
      <el-form label-position="top" size="small">
        <el-form-item :label="t('admin.tokenNameLabel')">
          <el-input v-model="tokenForm.name" maxlength="64" :placeholder="t('admin.tokenNamePlaceholder')"></el-input>
        </el-form-item>
        <el-form-item :label="t('admin.colScopes')">
          <el-checkbox-group v-model="tokenForm.scopes" class="token-scope-group">
            <el-checkbox label="upload"><i class="fas fa-upload"></i> {{ t('admin.scopeUpload') }}</el-checkbox>
            <el-checkbox label="read"><i class="fas fa-eye"></i> {{ t('admin.scopeRead') }}</el-checkbox>
            <el-checkbox label="delete"><i class="fas fa-trash-alt"></i> {{ t('admin.scopeDelete') }}</el-checkbox>
            <el-checkbox label="paste"><i class="fas fa-file-alt"></i> {{ t('admin.scopePaste') }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item :label="t('admin.expiryLabel')">
          <el-select v-model="tokenForm.expiryPreset" :placeholder="t('admin.expiryPlaceholder')" style="width:100%;">
            <el-option :label="t('admin.expiryNever')" value="never"></el-option>
            <el-option :label="t('admin.expiry7d')" value="7d"></el-option>
            <el-option :label="t('admin.expiry30d')" value="30d"></el-option>
            <el-option :label="t('admin.expiry90d')" value="90d"></el-option>
            <el-option :label="t('admin.expiryCustom')" value="custom"></el-option>
          </el-select>
        </el-form-item>
        <el-form-item v-if="tokenForm.expiryPreset === 'custom'" :label="t('admin.customExpiryLabel')">
          <el-date-picker
            v-model="tokenForm.customExpiresAt"
            type="datetime"
            style="width:100%;"
            value-format="timestamp"
            :placeholder="t('admin.customExpiryPlaceholder')">
          </el-date-picker>
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button size="small" @click="createTokenDialogVisible = false">{{ t('admin.cancel') }}</el-button>
        <el-button size="small" type="primary" :loading="tokenCreateLoading" @click="createApiToken">{{ t('admin.create') }}</el-button>
      </span>
    </el-dialog>

    <el-dialog
      :title="t('admin.tokenCreatedTitle')"
      :visible.sync="createdTokenDialogVisible"
      width="620px"
      append-to-body
      custom-class="token-created-dialog">
      <div class="token-once-warning">
        <i class="fas fa-exclamation-triangle"></i>
        {{ t('admin.tokenOnceWarning') }}
      </div>
      <el-input
        type="textarea"
        :rows="3"
        readonly
        :value="createdTokenValue">
      </el-input>
      <div class="token-created-actions">
        <el-button size="small" type="primary" @click="copyCreatedTokenValue">
          {{ createdTokenCopied ? t('admin.tokenCopied') : t('admin.copyToken') }}
        </el-button>
      </div>
    </el-dialog>

    <!-- 预览弹窗 - 模态框模式（不跳转新标签页） -->
    <div class="preview-modal" ref="previewModal" v-if="previewData" @click="closePreview">
      <button class="preview-close" @click.stop="closePreview">
        <i class="fas fa-times"></i>
      </button>
      <!-- 原生图片预览 -->
      <img v-if="previewData.type === 'native-image'" :src="previewData.url" @click.stop>
      <!-- 原生视频预览 -->
      <video v-else-if="previewData.type === 'video'" class="preview-media" :src="previewData.url" controls autoplay playsinline @click.stop></video>
      <!-- 原生音频预览 -->
      <audio v-else-if="previewData.type === 'audio'" class="preview-media-audio" :src="previewData.url" controls autoplay @click.stop></audio>
      <!-- PDF / 文本类本地预览（sandbox 阻止上传文件中的脚本在本站执行） -->
      <div v-else-if="previewData.type === 'iframe'" class="iframe-container" @click.stop>
        <iframe
          ref="previewIframe"
          :src="previewData.iframeUrl"
          :sandbox="previewData.sandbox"
          allow="autoplay; fullscreen"
          allowfullscreen>
        </iframe>
      </div>
      <!-- 不支持在线预览（office/压缩包等）→ 提示下载 -->
      <div v-else-if="previewData.type === 'unsupported'" class="preview-unsupported" @click.stop>
        <i class="fas fa-file"></i>
        <h3>{{ t('admin.previewUnsupportedTitle') }}</h3>
        <p>{{ t('admin.previewUnsupportedDesc') }}</p>
      </div>
      <!-- 底部操作栏 -->
      <div class="preview-toolbar" @click.stop>
        <span class="preview-filename">{{ previewData.fileName }}</span>
        <div class="preview-btns">
          <el-button size="small" v-if="previewData.type !== 'audio'" @click="togglePreviewFullscreen" :title="isFullscreen ? t('admin.exitFullscreen') : t('admin.fullscreen')"><i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i> {{ isFullscreen ? t('admin.exitFullscreen') : t('admin.fullscreen') }}</el-button>
          <el-button size="small" type="primary" @click="copyPreviewLink"><i class="fas fa-copy"></i> {{ t('admin.copyDirectLink') }}</el-button>
          <el-button size="small" @click="downloadPreviewFile"><i class="fas fa-download"></i> {{ t('admin.download') }}</el-button>
        </div>
      </div>
    </div>`;
}
