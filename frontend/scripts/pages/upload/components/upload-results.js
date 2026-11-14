{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.uploadResults = `        <!-- 右侧结果区 -->
        <div class="card result-section">
          <div class="card-header">
            <div class="card-title">
              <i class="fas fa-images"></i>
              <span>{{ t('home.uploadResult') }}</span>
              <span
                v-if="uploadedFiles.length > 0"
                style="font-size: 0.8em; color: var(--text-muted); margin-left: 8px"
              >
                ({{ uploadedFiles.length }}{{ t('home.filesSuffix') }})
              </span>
            </div>
            <div class="result-actions" v-if="uploadedFiles.length > 0">
              <el-button size="mini" type="primary" @click="selectAll">
                {{ isAllSelected ? t('home.deselectAll') : t('home.selectAll') }}
              </el-button>
              <el-button
                size="mini"
                type="success"
                @click="copySelectedLinks"
                :disabled="selectedCount === 0"
              >
                {{ t('home.copySelected') }} ({{ selectedCount }})
              </el-button>
              <el-button size="mini" type="warning" @click="copyAllLinks">
                {{ t('home.copyAll') }}
              </el-button>
              <el-button size="mini" type="danger" @click="clearResults">
                {{ t('home.clear') }}
              </el-button>
              <button
                class="result-view-toggle"
                @click="toggleResultViewMode"
                :title="resultViewMode === 'grid' ? t('home.viewGrid') : t('home.viewList')"
              >
                <i :class="resultViewMode === 'grid' ? 'fas fa-th' : 'fas fa-list'"></i>
              </button>
            </div>
          </div>

          <!-- 链接格式选择 -->
          <div class="link-format-tabs" v-if="uploadedFiles.length > 0">
            <span
              class="format-tab"
              :class="{ active: linkFormat === 'url' }"
              @click="linkFormat = 'url'"
              >{{ t('home.directUrl') }}</span
            >
            <span
              class="format-tab"
              :class="{ active: linkFormat === 'markdown' }"
              @click="linkFormat = 'markdown'"
              >Markdown</span
            >
            <span
              class="format-tab"
              :class="{ active: linkFormat === 'html' }"
              @click="linkFormat = 'html'"
              >HTML</span
            >
            <span
              class="format-tab"
              :class="{ active: linkFormat === 'bbcode' }"
              @click="linkFormat = 'bbcode'"
              >BBCode</span
            >
            <span
              class="format-tab"
              :class="{ active: linkFormat === 'ubb' }"
              @click="linkFormat = 'ubb'"
              >UBB</span
            >
            <button
              class="result-view-toggle"
              @click="toggleUploadSort"
              :title="uploadSortDesc ? t('home.sortDesc') : t('home.sortAsc')"
            >
              <i :class="uploadSortDesc ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up'"></i>
            </button>
          </div>

          <!-- 上传结果列表 -->
          <div
            class="result-list"
            :class="{ 'is-grid': resultViewMode === 'grid' }"
            v-if="uploadedFiles.length > 0"
          >
            <div
              class="result-item"
              v-for="file in displayedFiles"
              :key="file.id"
              :class="{ selected: file.selected }"
            >
              <input
                type="checkbox"
                class="result-item-checkbox"
                v-model="file.selected"
              />
              <img
                :src="getCleanFileUrl(file)"
                class="result-item-preview"
                @click="previewImage(getCleanFileUrl(file))"
                onerror="this.style.display='none'"
              />
              <div class="result-item-info">
                <div class="result-item-name">{{ getDisplayName(file) }}</div>
                <div class="result-item-target" v-if="file.storageName">{{ file.storageMode }} · {{ file.storageName }}</div>
                <div
                  class="result-item-link"
                  @click="copyLink(file)"
                  :title="formatLink(file)"
                >
                  {{ formatLink(file) }}
                </div>
              </div>
              <div class="result-item-actions">
                <button
                  class="action-btn"
                  @click="copyLink(file)"
                  :title="t('home.copyLink')"
                >
                  <i class="fas fa-copy"></i>
                </button>
                <button
                  class="action-btn"
                  @click="downloadFile(file)"
                  :title="t('home.download')"
                >
                  <i class="fas fa-download"></i>
                </button>
                <button
                  class="action-btn"
                  @click="openPreview(file)"
                  :title="t('home.preview')"
                >
                  <i class="fas fa-eye"></i>
                </button>
                <button
                  class="action-btn delete"
                  @click="removeFromResults(file)"
                  :title="t('home.remove')"
                >
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- 批量复制文本框 -->
          <textarea
            class="batch-links"
            v-if="uploadedFiles.length > 0"
            :value="getBatchLinks()"
            readonly
            @click="$event.target.select()"
            :placeholder="t('home.batchPh')"
          ></textarea>

          <!-- 空状态 -->
          <div class="empty-state" v-if="uploadedFiles.length === 0">
            <i class="fas fa-cloud-upload-alt"></i>
            <div>{{ t('home.emptyTitle') }}</div>
            <div style="margin-top: 8px; font-size: 0.9em">
              {{ t('home.emptyHint') }}
            </div>
          </div>
        </div>
      </div>
`;
}
