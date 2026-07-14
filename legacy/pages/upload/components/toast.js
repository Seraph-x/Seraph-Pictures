{
  'use strict';
  globalThis.LegacyUploadComponents = globalThis.LegacyUploadComponents || {};
  globalThis.LegacyUploadComponents.toast = `      <!-- Toast 容器 -->
      <div class="toast-container">
        <div
          class="toast"
          :class="toast.type"
          v-for="(toast, index) in toasts"
          :key="index"
        >
          <i :class="getToastIcon(toast.type)"></i>
          <span>{{ toast.message }}</span>
        </div>
      </div>
    </div>`;
}
