{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.uploadQueue = `          <!-- 上传进度列表 -->
          <div class="upload-list" v-if="uploadingFiles.length > 0">
            <div
              class="card-title"
              style="
                margin-top: 20px;
                margin-bottom: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
              "
            >
              <div>
                <i class="fas fa-tasks"></i>
                <span>{{ t('home.uploadQueue') }} ({{ uploadingFiles.length }})</span>
                <span
                  v-if="failedCount > 0"
                  style="color: #f56c6c; margin-left: 8px; font-size: 0.85em"
                >
                  ({{ failedCount }} {{ t('home.failedSuffix') }})
                </span>
              </div>
              <div style="display: flex; gap: 8px">
                <el-button
                  v-if="failedCount > 0"
                  size="mini"
                  type="warning"
                  @click="retryAllFailed"
                >
                  <i class="fas fa-redo"></i> {{ t('home.retryAllFailed') }} ({{ failedCount }})
                </el-button>
                <el-button size="mini" type="info" @click="clearUploadQueue">
                  <i class="fas fa-broom"></i> {{ t('home.clearQueue') }}
                </el-button>
              </div>
            </div>
            <div
              class="upload-item"
              v-for="(file, index) in uploadingFiles"
              :key="index"
            >
              <img
                v-if="file.preview"
                :src="file.preview"
                class="upload-item-preview"
              />
              <div
                v-else
                class="upload-item-preview"
                style="
                  display: flex;
                  align-items: center;
                  justify-content: center;
                "
              >
                <i
                  :class="getFileIcon(file.name)"
                  style="font-size: 1.5em; color: var(--text-muted)"
                ></i>
              </div>
              <div class="upload-item-info">
                <div class="upload-item-name">{{ file.name }}</div>
                <div class="upload-item-size">{{ formatSize(file.size) }}</div>
                <div class="upload-item-target">{{ getItemStorageTarget(file) }} · {{ getItemFolderPath(file) || t('home.rootDir') }}</div>
                <div v-if="file.compressionStatus" class="upload-item-compression">
                  {{ file.compressionStatus }}
                </div>
                <div v-if="file.error" class="upload-item-error">
                  {{ file.error }}
                </div>
              </div>
              <div class="upload-item-status" :class="file.status">
                <span
                  class="loading-spinner"
                  v-if="file.status === 'uploading' || file.status === 'processing'"
                ></span>
                <i
                  class="fas fa-check-circle"
                  v-if="file.status === 'success'"
                ></i>
                <i
                  class="fas fa-times-circle"
                  v-if="file.status === 'error'"
                ></i>
                <span
                  >{{ getStatusText(file.status) }}
                  <span v-if="file.progress">({{ file.progress }}%)</span></span
                >
              </div>
              <button
                v-if="file.status === 'error'"
                class="action-btn"
                @click="retryUpload(file)"
                :title="t('home.retry')"
              >
                <i class="fas fa-redo"></i>
              </button>
            </div>
          </div>
        </div>
`;
}
