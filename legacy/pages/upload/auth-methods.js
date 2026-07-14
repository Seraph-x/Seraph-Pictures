{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async checkStorageTarget() {
            const response = await fetch('/api/status', { credentials: 'include' });
            const status = await response.json();
            if (!response.ok) throw new Error(status?.error || 'STORAGE_STATUS_CHECK_FAILED');
            this.applyStorageAvailability(status);
            this.restoreStorageMode();
          },
applyStorageAvailability(status) {
            this.uploadLimits = status.uploadLimits || {};
            this.r2Available = this.storageEnabledFromStatus(status.r2);
            this.s3Available = this.storageEnabledFromStatus(status.s3);
            this.discordAvailable = this.storageEnabledFromStatus(status.discord);
            this.huggingfaceAvailable = this.storageEnabledFromStatus(status.huggingface);
            this.githubAvailable = this.storageEnabledFromStatus(status.github);
          },
restoreStorageMode() {
            const savedMode = localStorage.getItem('storageMode');
            const available = {
              telegram: true, r2: this.r2Available, s3: this.s3Available,
              discord: this.discordAvailable, huggingface: this.huggingfaceAvailable,
              github: this.githubAvailable,
            };
            const labels = {
              telegram: this.t('home.tgChannel'), r2: this.t('home.r2Bucket'),
              s3: this.t('home.s3Store'), discord: this.t('home.discordChannel'),
              huggingface: this.t('home.hfRepo'), github: this.t('home.ghRepo'),
            };
            const allowed = savedMode && available[savedMode] && (!this.isGuest || savedMode === 'telegram');
            this.storageMode = allowed ? savedMode : 'telegram';
            this.storageTarget = labels[this.storageMode];
          },
setStorageMode(mode) {
            const modeConfig = {
              telegram: { label: this.t('home.tgChannel'), available: true },
              r2: { label: this.t('home.r2Bucket'), available: this.r2Available },
              s3: { label: this.t('home.s3Store'), available: this.s3Available },
              discord: {
                label: this.t('home.discordChannel'),
                available: this.discordAvailable,
              },
              huggingface: {
                label: this.t('home.hfRepo'),
                available: this.huggingfaceAvailable,
              },
              github: {
                label: this.t('home.ghRepo'),
                available: this.githubAvailable,
              },
            };

            const config = modeConfig[mode];
            if (!config) return;
            if (this.authChecking) return;

            // 访客只允许 telegram 和 r2
            if (this.isGuest && !["telegram", "r2"].includes(mode)) {
              this.showToast(this.t('home.toastGuestStorage'), "error");
              return;
            }

            if (!config.available && mode !== "telegram") {
              this.showToast(this.t('home.toastNotConfigured', { label: config.label }), "error");
              return;
            }

            this.storageMode = mode;
            this.storageTarget = config.label;
            if (!this.isGuest) this.resolveStorageProfile();
            localStorage.setItem("storageMode", mode);
            this.showToast(this.t('home.toastSwitched', { label: config.label }), "success");
          }
  }});
}
