{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.previewDialog = `      <!-- 预览弹窗 - 原生图片 / iframe 预览 -->
      <div class="preview-modal" ref="previewModal" v-if="previewData" @click="closePreview">
        <button class="preview-close" @click.stop="closePreview">
          <i class="fas fa-times"></i>
        </button>
        <!-- 原生图片预览 -->
        <img
          v-if="previewData.type === 'native-image'"
          :src="previewData.url"
          @click.stop
        />
        <!-- 原生视频预览 -->
        <video
          v-else-if="previewData.type === 'video'"
          class="preview-media"
          :src="previewData.url"
          controls
          autoplay
          playsinline
          @click.stop
        ></video>
        <!-- 原生音频预览 -->
        <audio
          v-else-if="previewData.type === 'audio'"
          class="preview-media-audio"
          :src="previewData.url"
          controls
          autoplay
          @click.stop
        ></audio>
        <!-- PDF / 文本类本地预览（sandbox 阻止上传文件中的脚本在本站执行） -->
        <div
          v-else-if="previewData.type === 'iframe'"
          class="iframe-container"
          @click.stop
        >
          <iframe
            ref="previewIframe"
            :src="previewData.iframeUrl"
            :sandbox="previewData.sandbox"
            allow="autoplay; fullscreen"
            allowfullscreen
          >
          </iframe>
        </div>
        <!-- 底部操作栏 -->
        <div class="preview-toolbar" @click.stop>
          <span class="preview-filename">{{ previewData.fileName }}</span>
          <div class="preview-btns">
            <button
              class="preview-btn preview-btn-default"
              v-if="previewData.type !== 'audio'"
              @click="togglePreviewFullscreen"
              :title="isFullscreen ? t('home.exitFullscreen') : t('home.fullscreen')"
            >
              <i :class="isFullscreen ? 'fas fa-compress' : 'fas fa-expand'"></i> {{ isFullscreen ? t('home.exitFullscreen') : t('home.fullscreen') }}
            </button>
            <button
              class="preview-btn preview-btn-primary"
              @click="copyPreviewLink"
            >
              <i class="fas fa-copy"></i> {{ t('home.copyDirectLink') }}
            </button>
            <button
              class="preview-btn preview-btn-default"
              @click="downloadPreviewFile"
            >
              <i class="fas fa-download"></i> {{ t('home.download') }}
            </button>
          </div>
        </div>
      </div>

      <div
        class="compress-confirm-modal"
        v-if="pendingUploadBatch"
        @click.self="cancelPendingUpload"
      >
        <div class="compress-confirm-card">
          <div class="compress-confirm-header">
            <div>
              <div class="compress-confirm-title">
                <i class="fas fa-images"></i>
                <span>{{ t('home.confirmTitle') }}</span>
              </div>
              <div class="compress-confirm-note">
                {{ t('home.confirmNote') }}
              </div>
            </div>
            <button
              class="compress-confirm-close"
              type="button"
              @click="cancelPendingUpload"
              :title="t('home.cancel')"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="compress-confirm-stats">
            <div class="compress-stat">
              <span>{{ t('home.fileCount') }}</span>
              <strong>{{ pendingUploadStats.fileCount }}</strong>
            </div>
            <div class="compress-stat">
              <span>{{ t('home.processableImages') }}</span>
              <strong>{{ pendingUploadStats.imageCount }}</strong>
            </div>
            <div class="compress-stat">
              <span>{{ t('home.totalSizeLabel') }}</span>
              <strong>{{ formatSize(pendingUploadStats.totalSize) }}</strong>
            </div>
          </div>

          <div class="compress-mode-grid">
            <button
              class="compress-mode-btn"
              type="button"
              :class="{ active: pendingCompressionChoice === 'original' }"
              @click="setPendingCompressionMode('original')"
            >
              <i class="fas fa-file-image"></i>
              <div>
                <strong>{{ t('home.modeOriginalTitle') }}</strong>
                <span>{{ t('home.modeOriginalDesc') }}</span>
              </div>
            </button>
            <button
              class="compress-mode-btn"
              type="button"
              :class="{ active: pendingCompressionChoice === 'compress' }"
              @click="setPendingCompressionMode('compress')"
            >
              <i class="fas fa-compress-alt"></i>
              <div>
                <strong>{{ t('home.modeCompressTitle') }}</strong>
                <span>{{ t('home.modeCompressDesc') }}</span>
              </div>
            </button>
          </div>

          <div class="compress-controls" v-if="pendingCompressionChoice === 'compress'">
            <div class="compress-format-grid">
              <button
                class="compress-format-btn"
                type="button"
                v-for="format in imageCompressFormats"
                :key="'modal-' + format.value"
                :class="{ active: imageCompress.format === format.value }"
                :disabled="!isFormatSupported(format.value)"
                @click="selectCompressFormat(format.value)"
                :title="isFormatSupported(format.value) ? format.tip : t('home.formatUnsupported') + format.label"
              >
                <i :class="format.icon"></i>
                <span>{{ format.label }}</span>
              </button>
            </div>
            <div class="compress-settings-grid">
              <div class="compress-control">
                <label>{{ t('home.quality') }}{{ imageCompress.quality }}%</label>
                <div class="compress-range-row">
                  <input
                    type="range"
                    min="30"
                    max="95"
                    step="1"
                    v-model.number="imageCompress.quality"
                    @change="saveImageCompressSettings"
                  />
                </div>
              </div>
              <div class="compress-control">
                <label>{{ t('home.maxDimension') }}</label>
                <div class="compress-range-row">
                  <input
                    class="compress-number"
                    type="number"
                    min="0"
                    max="12000"
                    step="100"
                    v-model.number="imageCompress.maxDimension"
                    @change="saveImageCompressSettings"
                  />
                  <span class="image-compress-summary">{{ t('home.maxDimHint') }}</span>
                </div>
              </div>
            </div>
            <label class="compress-checkbox">
              <input
                type="checkbox"
                v-model="imageCompress.keepOriginalWhenLarger"
                @change="saveImageCompressSettings"
              />
              {{ t('home.keepOriginal') }}
            </label>
          </div>

          <div class="compress-confirm-actions">
            <button
              class="compress-action-btn"
              type="button"
              @click="cancelPendingUpload"
            >
              {{ t('home.cancel') }}
            </button>
            <button
              class="compress-action-btn"
              :class="{ primary: pendingCompressionChoice === 'original' }"
              type="button"
              @click="uploadPendingOriginal"
            >
              <i class="fas fa-file-upload"></i>
              {{ t('home.uploadOriginal') }}
            </button>
            <button
              class="compress-action-btn"
              :class="{ primary: pendingCompressionChoice === 'compress' }"
              type="button"
              @click="uploadPendingCompressed"
            >
              <i class="fas fa-compress-alt"></i>
              {{ t('home.uploadCompressed') }}
            </button>
          </div>
        </div>
      </div>
`;
}
