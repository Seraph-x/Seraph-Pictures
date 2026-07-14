{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.uploadPanel = `      <!-- 主内容区 -->
      <div class="main-container">
        <!-- 左侧上传区 -->
        <div class="card upload-section">
          <div class="card-header">
            <div class="card-title">
              <i class="fas fa-upload"></i>
              <span>{{ t('home.uploadTitle') }}</span>
            </div>
            <span
              v-if="!authChecking && isGuest && guestUploadConfig"
              style="color: var(--warning-text-color); font-size: 0.85em"
              >{{ t('guest.notice1') }} {{
              formatSize(guestUploadConfig.maxFileSize) }}</span
            >
            <span v-else style="color: var(--text-muted); font-size: 0.85em">
              Max {{ currentUploadLimitLabel }} per file for selected storage
            </span>
          </div>

          <!-- 上传区域 -->
          <div
            class="upload-zone"
            @click="triggerUpload"
            @dragover.prevent="onDragOver"
            @dragleave="onDragLeave"
            @drop.prevent="onDrop"
            :class="{ dragover: isDragging }"
          >
            <i class="fas fa-cloud-upload-alt upload-icon"></i>
            <div class="upload-text">{{ t('home.uploadZoneText') }}</div>
            <div class="upload-hint" v-if="!authChecking && isGuest && guestUploadConfig">
              {{ t('home.guestHint1') }} {{ formatSize(guestUploadConfig.maxFileSize)
              }}{{ t('home.guestHint2') }}
            </div>
            <div class="upload-hint" v-else>
              Supports images, videos, audio, and documents. Current limit:
              {{ currentUploadLimitLabel }}.
            </div>
            <input
              type="file"
              class="upload-input"
              ref="fileInput"
              multiple
              @change="handleFileSelect"
            />
          </div>

          <!-- 存储位置切换 -->
          <div class="storage-switcher">
            <span class="storage-label">{{ t('home.storageLabel') }}</span>
            <div class="storage-options">
              <button
                class="storage-btn"
                :class="{ active: storageMode === 'telegram' }"
                @click="setStorageMode('telegram')"
              >
                <i class="fab fa-telegram"></i>
                <span>Telegram</span>
              </button>
              <button
                class="storage-btn"
                v-if="!isGuest"
                :class="{ active: storageMode === 'r2', disabled: !r2Available }"
                @click="setStorageMode('r2')"
                :disabled="!r2Available"
                :title="!r2Available ? t('home.r2NotConfigured') : t('home.r2Configured')"
              >
                <i class="fas fa-cloud"></i>
                <span>{{ t('home.r2') }}</span>
              </button>
              <button
                class="storage-btn"
                v-if="!isGuest"
                :class="{ active: storageMode === 's3', disabled: !s3Available }"
                @click="setStorageMode('s3')"
                :disabled="!s3Available"
                :title="!s3Available ? t('home.s3NotConfigured') : t('home.s3Configured')"
              >
                <i class="fas fa-database"></i>
                <span>S3 API</span>
              </button>
              <button
                class="storage-btn"
                v-if="!isGuest"
                :class="{ active: storageMode === 'discord', disabled: !discordAvailable }"
                @click="setStorageMode('discord')"
                :disabled="!discordAvailable"
                :title="!discordAvailable ? t('home.discordNotConfigured') : t('home.discordConfigured')"
              >
                <i class="fab fa-discord"></i>
                <span>Discord</span>
              </button>
              <button
                class="storage-btn"
                v-if="!isGuest"
                :class="{ active: storageMode === 'huggingface', disabled: !huggingfaceAvailable }"
                @click="setStorageMode('huggingface')"
                :disabled="!huggingfaceAvailable"
                :title="!huggingfaceAvailable ? t('home.hfNotConfigured') : t('home.hfConfigured')"
              >
                <i class="fas fa-robot"></i>
                <span>HuggingFace</span>
              </button>
              <button
                class="storage-btn"
                v-if="!isGuest"
                :class="{ active: storageMode === 'github', disabled: !githubAvailable }"
                @click="setStorageMode('github')"
                :disabled="!githubAvailable"
                :title="!githubAvailable ? t('home.ghNotConfigured') : t('home.ghConfigured')"
              >
                <i class="fab fa-github"></i>
                <span>GitHub</span>
              </button>
            </div>
          </div>

${globalThis.LegacyUploadComponents.storageTargetPicker}
          <!-- 上传方式按钮 -->
          <div class="folder-target-panel">
            <div class="folder-target-head">
              <span class="folder-target-title">
                <i class="fas fa-folder-tree"></i>
                <span>{{ t('home.uploadDir') }}</span>
              </span>
              <span class="folder-target-badge">
                <i class="fas fa-map-marker-alt"></i>
                {{ folderPath || t('home.rootDir') }}
              </span>
            </div>
            <div class="folder-target-row">
              <input
                type="text"
                v-model="folderPath"
                :placeholder="t('home.folderPh')"
                @input="handleFolderPathInput"
                @blur="folderPath = normalizeFolderPath(folderPath)"
              />
              <button class="folder-reset-btn" type="button" @click="clearFolderPath">
                {{ t('home.rootDir') }}
              </button>
            </div>
            <div class="folder-target-tip">
              {{ t('home.folderTip') }}
            </div>
          </div>

          <div
            class="image-compress-panel"
            :class="{ 'is-enabled': imageCompress.enabled || imageUploadDecision === 'optimized' }"
          >
            <div class="image-compress-head">
              <div class="image-compress-title">
                <i class="fas fa-compress-alt"></i>
                <div>
                  <strong>{{ t('home.compressTitle') }}</strong>
                  <span>Choose whether image uploads keep originals, optimize automatically, or ask per batch.</span>
                </div>
              </div>
              <label class="compress-toggle" :title="t('home.compressToggleTip')">
                <span>{{ imageCompress.enabled ? t('home.on') : t('home.off') }}</span>
                <input
                  type="checkbox"
                  v-model="imageCompress.enabled"
                  @change="saveImageCompressSettings"
                />
                <span class="compress-toggle-track"></span>
              </label>
            </div>
            <div class="image-compress-summary">{{ imageCompressSummary }}</div>
            <div class="image-upload-decision" role="group" aria-label="Image upload behavior">
              <button
                type="button"
                :class="{ active: imageUploadDecision === 'original' }"
                @click.stop="setImageUploadDecision('original')"
              >
                Original
              </button>
              <button
                type="button"
                :class="{ active: imageUploadDecision === 'optimized' }"
                @click.stop="setImageUploadDecision('optimized')"
              >
                Optimized
              </button>
              <button
                type="button"
                :class="{ active: imageUploadDecision === 'ask' }"
                @click.stop="setImageUploadDecision('ask')"
              >
                Ask
              </button>
            </div>
            <div class="image-compress-summary">{{ imageUploadDecisionSummary }}</div>
            <div class="compress-controls" v-if="imageCompress.enabled || imageUploadDecision === 'optimized'">
              <div class="compress-format-grid">
                <button
                  class="compress-format-btn"
                  type="button"
                  v-for="format in imageCompressFormats"
                  :key="format.value"
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
          </div>

          <div class="upload-methods">
            <button class="method-btn" @click="triggerUpload">
              <i class="fas fa-folder-open"></i>
              <span>{{ t('home.selectFile') }}</span>
            </button>
            <button class="method-btn" @click="pasteFromClipboard">
              <i class="fas fa-paste"></i>
              <span>{{ t('home.pasteUpload') }}</span>
            </button>
            <button class="method-btn" @click="showUrlInput = !showUrlInput">
              <i class="fas fa-link"></i>
              <span>{{ t('home.urlUpload') }}</span>
            </button>
          </div>
`;
}
