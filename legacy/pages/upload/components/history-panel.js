{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.historyPanel = `      <!-- 上传历史区域 -->
      <div class="card history-section" v-if="uploadHistory.length > 0">
        <div class="card-header">
          <div class="card-title">
            <i class="fas fa-history"></i>
            <span>{{ t('home.localHistory') }}</span>
            <span style="font-size: 0.8em; color: var(--text-muted); margin-left: 8px"
              >({{ uploadHistory.length }})</span
            >
          </div>
          <div class="result-actions">
            <el-button size="mini" type="primary" @click="selectAllHistory">
              {{ isAllHistorySelected ? t('home.deselectAll') : t('home.selectAll') }}
            </el-button>
            <el-button
              size="mini"
              type="success"
              @click="copySelectedHistoryLinks"
              :disabled="selectedHistoryCount === 0"
            >
              {{ t('home.copySelected') }} ({{ selectedHistoryCount }})
            </el-button>
            <el-button size="mini" type="danger" @click="clearHistory">
              {{ t('home.clearHistory') }}
            </el-button>
          </div>
        </div>

        <!-- 统计条 -->
        <div class="stats-bar">
          <div class="stat-item">
            <i class="fas fa-images"></i>
            <span
              >{{ t('home.statImages') }}
              <span class="stat-value">{{ historyStats.images }}</span></span
            >
          </div>
          <div class="stat-item">
            <i class="fas fa-video"></i>
            <span
              >{{ t('home.statVideos') }}
              <span class="stat-value">{{ historyStats.videos }}</span></span
            >
          </div>
          <div class="stat-item">
            <i class="fas fa-file"></i>
            <span
              >{{ t('home.statOthers') }}
              <span class="stat-value">{{ historyStats.others }}</span></span
            >
          </div>
          <div class="stat-item">
            <i class="fas fa-hdd"></i>
            <span
              >{{ t('home.statTotalSize') }}
              <span class="stat-value"
                >{{ formatSize(historyStats.totalSize) }}</span
              ></span
            >
          </div>
        </div>

        <!-- 历史记录网格 -->
        <div class="history-grid">
          <div
            class="history-item"
            v-for="(item, index) in uploadHistory"
            :key="index"
            :class="{ selected: item.selected }"
            @click="toggleHistorySelect(index)"
            :title="getDisplayName(item)"
          >
            <!-- 图片文件显示缩略图 -->
            <img
              v-if="isImageFile(getDisplayName(item))"
              :src="getCleanFileUrl(item)"
              @error="handleHistoryImgError($event, item)"
            />
            <!-- 非图片文件显示图标 -->
            <div
              v-else
              class="history-file-icon"
              :class="getFileIconClass(getDisplayName(item))"
            >
              <i :class="getFileIcon(getDisplayName(item))"></i>
              <span class="file-ext"
                >{{ getFileExt(getDisplayName(item)) }}</span
              >
            </div>
            <div class="history-item-overlay">
              <button
                class="action-btn"
                @click.stop="copyLink(item)"
                style="background: rgba(255, 255, 255, 0.2); color: white"
              >
                <i class="fas fa-copy"></i>
              </button>
              <button
                class="action-btn"
                @click.stop="openPreview(item)"
                style="background: rgba(255, 255, 255, 0.2); color: white"
              >
                <i class="fas fa-eye"></i>
              </button>
              <button
                class="action-btn delete"
                @click.stop="removeFromHistory(index)"
                style="background: rgba(245, 108, 108, 0.8)"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
`;
}
