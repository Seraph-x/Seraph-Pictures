{
  'use strict';
  globalThis.LegacyUploadMixins = globalThis.LegacyUploadMixins || [];
  globalThis.LegacyUploadMixins.push({ methods: {
async copyToClipboard(text) {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return;
              }
            } catch (err) {
              // Clipboard API 失败（权限不足或页面无焦点），使用 fallback
            }
            // Fallback: execCommand
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
          },
showToast(message, type = "info") {
            const toast = { message, type };
            this.toasts.push(toast);
            setTimeout(() => {
              const index = this.toasts.indexOf(toast);
              if (index > -1) this.toasts.splice(index, 1);
            }, 3000);
          },
getToastIcon(type) {
            const icons = {
              success: "fas fa-check-circle",
              error: "fas fa-times-circle",
              info: "fas fa-info-circle",
            };
            return icons[type] || icons.info;
          },
async checkAuth() {
            this.authChecking = true;
            try {
              const response = await fetch("/api/auth/check", {
                credentials: "include",
              });
              const data = await response.json();

              if (data.authRequired && !data.authenticated) {
                this.isAuthenticated = false;
                if (data.guestUpload && data.guestUpload.enabled) {
                  this.isGuest = true;
                  this.guestUploadConfig = {
                    maxFileSize: data.guestUpload.maxFileSize || 5 * 1024 * 1024,
                    maxDailyUploads: data.guestUpload.dailyLimit || 10,
                  };
                  this.storageMode = "telegram";
                  this.storageTarget = this.t('home.tgChannel');
                  return true;
                }
                window.location.href =
                  "/login?redirect=" +
                  encodeURIComponent(window.location.pathname);
                return false;
              }

              this.isGuest = false;
              this.guestUploadConfig = null;
              this.isAuthenticated = data.authRequired && data.authenticated;
              return true;
            } catch (error) {
              throw Object.assign(new Error('AUTH_CHECK_FAILED'), { cause: error });
            } finally {
              this.authChecking = false;
            }
          }
  }});
}
