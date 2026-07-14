{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.urlUpload = `          <!-- URL上传 -->
          <div class="url-input-container" v-if="showUrlInput">
            <input
              type="text"
              v-model="urlToUpload"
              :placeholder="t('home.urlPh')"
              @keyup.enter="uploadFromUrl"
            />
            <el-button
              type="primary"
              @click="uploadFromUrl"
              :loading="urlUploading"
              >{{ t('home.upload') }}</el-button
            >
          </div>
`;
}
