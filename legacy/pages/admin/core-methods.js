{
  'use strict';
  globalThis.LegacyAdminMixins = globalThis.LegacyAdminMixins || [];
  globalThis.LegacyAdminMixins.push({ methods: {
t(key, params) {
        void this.lang;
        return window.I18n ? I18n.t(key, params) : key;
      },
normalizeFolderPath(value = '') {
        const raw = String(value || '').replace(/\\/g, '/').trim();
        const output = [];
        raw.split('/').forEach((part) => {
          const piece = part.trim();
          if (!piece || piece === '.') return;
          if (piece === '..') {
            output.pop();
            return;
          }
          output.push(piece);
        });
        return output.join('/');
      },
isUnconfiguredStatus(item = {}) {
        const message = String(item?.message || '').trim().toLowerCase();
        return message === '未配置' || message === 'not configured' || message.includes('not configured');
      },
tokenScopeTagType(scopeName = '') {
        const map = {
          upload: '',
          read: 'success',
          delete: 'danger',
          paste: 'warning',
        };
        return map[String(scopeName || '').toLowerCase()] || 'info';
      },
formatDateTime(timestamp) {
        const value = Number(timestamp || 0);
        if (!Number.isFinite(value) || value <= 0) return '-';
        return new Date(value).toLocaleString('zh-CN', { hour12: false });
      },
formatRelativeTime(timestamp) {
        const value = Number(timestamp || 0);
        if (!Number.isFinite(value) || value <= 0) return this.t('admin.never');
        const diff = Date.now() - value;
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < minute) return this.t('admin.justNow');
        if (diff < hour) return this.t('admin.minutesAgo', { n: Math.floor(diff / minute) });
        if (diff < day) return this.t('admin.hoursAgo', { n: Math.floor(diff / hour) });
        if (diff < day * 30) return this.t('admin.daysAgo', { n: Math.floor(diff / day) });
        return this.formatDateTime(value);
      },
openApiTokenDialog() {
        this.tokenDialogVisible = true;
        this.loadApiTokens();
      },
openCreateTokenDialog() {
        this.tokenForm = {
          name: '',
          scopes: ['upload', 'read'],
          expiryPreset: 'never',
          customExpiresAt: '',
        };
        this.createTokenDialogVisible = true;
      },
resolveTokenExpiresAt() {
        const preset = String(this.tokenForm.expiryPreset || 'never');
        if (preset === '7d') return Date.now() + 7 * 24 * 3600 * 1000;
        if (preset === '30d') return Date.now() + 30 * 24 * 3600 * 1000;
        if (preset === '90d') return Date.now() + 90 * 24 * 3600 * 1000;
        if (preset === 'custom') {
          const custom = Number(this.tokenForm.customExpiresAt || 0);
          return Number.isFinite(custom) && custom > Date.now() ? custom : null;
        }
        return null;
      },
async loadApiTokens() {
        this.tokenLoading = true;
        try {
          const response = await fetch('/api/admin/tokens', {
            method: 'GET',
            credentials: 'include',
          });
          const payload = await response.json();
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error?.message || payload?.message || this.t('admin.loadTokenListFailed'));
          }
          this.apiTokens = Array.isArray(payload.tokens) ? payload.tokens : [];
        } catch (error) {
          this.$message.error(error.message || this.t('admin.loadTokenFailed'));
        } finally {
          this.tokenLoading = false;
        }
      },
buildTokenPayload() {
        const name = String(this.tokenForm.name ?? '').trim();
        const scopes = Array.isArray(this.tokenForm.scopes) ? this.tokenForm.scopes : [];
        if (!name) {
          this.$message.warning(this.t('admin.enterTokenName'));
          return null;
        }
        if (scopes.length === 0) {
          this.$message.warning(this.t('admin.selectAtLeastOneScope'));
          return null;
        }
        const expiresAt = this.resolveTokenExpiresAt();
        if (String(this.tokenForm.expiryPreset) === 'custom' && !expiresAt) {
          this.$message.warning(this.t('admin.selectValidExpiry'));
          return null;
        }
        return Object.freeze({ name, scopes, expiresAt });
      },
async requestCreateApiToken(payload) {
        const response = await fetch('/api/admin/tokens', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();
        if (response.ok && result?.success) return result;
        const message = result?.error?.message ?? result?.message ?? this.t('admin.createTokenFailed');
        throw new Error(message);
      },
async createApiToken() {
        const request = this.buildTokenPayload();
        if (!request) return;
        this.tokenCreateLoading = true;
        try {
          const payload = await this.requestCreateApiToken(request);
          this.createTokenDialogVisible = false;
          this.createdTokenValue = String(payload.token ?? '');
          this.createdTokenCopied = false;
          this.createdTokenDialogVisible = true;
          await this.loadApiTokens();
        } catch (error) {
          this.$message.error(error.message ?? this.t('admin.createTokenFailed'));
          throw error;
        } finally {
          this.tokenCreateLoading = false;
        }
      },
async copyCreatedTokenValue() {
        const token = String(this.createdTokenValue || '');
        if (!token) return;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(token);
          } else {
            this.copyToClipboardFallback(token);
          }
          this.createdTokenCopied = true;
        } catch {
          this.copyToClipboardFallback(token);
          this.createdTokenCopied = true;
        }
      },
async toggleApiTokenEnabled(token) {
        const tokenId = token?.id;
        if (!tokenId) return;
        const nextEnabled = Boolean(token.enabled);
        this.$set(this.tokenMutatingMap, tokenId, true);
        try {
          const response = await fetch(`/api/admin/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: nextEnabled }),
          });
          const payload = await response.json();
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error?.message || payload?.message || this.t('admin.updateTokenStatusFailed'));
          }
          this.$message.success(nextEnabled ? this.t('admin.tokenEnabledMsg') : this.t('admin.tokenDisabledMsg'));
        } catch (error) {
          token.enabled = !nextEnabled;
          this.$message.error(error.message || this.t('admin.updateTokenStatusFailed'));
        } finally {
          this.$delete(this.tokenMutatingMap, tokenId);
        }
      },
async removeApiToken(token) {
        const tokenId = token?.id;
        if (!tokenId) return;
        try {
          await this.$confirm(this.t('admin.confirmDeleteToken', { name: token.name }), this.t('admin.deleteConfirmTitle'), {
            type: 'warning',
            confirmButtonText: this.t('admin.confirmDelete'),
            cancelButtonText: this.t('admin.cancel'),
          });
        } catch {
          return;
        }

        this.$set(this.tokenMutatingMap, tokenId, true);
        try {
          const response = await fetch(`/api/admin/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          const payload = await response.json();
          if (!response.ok || !payload?.success) {
            throw new Error(payload?.error?.message || payload?.message || this.t('admin.deleteTokenFailed'));
          }
          this.apiTokens = this.apiTokens.filter((item) => item.id !== tokenId);
          this.$message.success(this.t('admin.tokenDeletedMsg'));
        } catch (error) {
          this.$message.error(error.message || this.t('admin.deleteTokenFailed'));
        } finally {
          this.$delete(this.tokenMutatingMap, tokenId);
        }
      },
queueMobileNavMetricsUpdate() {
        if (this.mobileNavMetricsRaf) {
          cancelAnimationFrame(this.mobileNavMetricsRaf);
        }
        this.mobileNavMetricsRaf = requestAnimationFrame(() => {
          this.mobileNavMetricsRaf = 0;
          this.updateMobileNavMetrics();
        });
      },
updateMobileNavMetrics() {
        const root = document.documentElement;
        if (!root) return;

        const isMobile = window.matchMedia('(max-width: 900px)').matches;
        if (!isMobile) {
          root.style.setProperty('--nav-height', '0px');
          root.style.setProperty('--nav-offset', '0px');
          return;
        }

        const header = (this.$el && this.$el.querySelector('.header-content')) || document.querySelector('.header-content');
        if (!header) return;

        const rect = header.getBoundingClientRect();
        const computed = window.getComputedStyle(header);
        const top = Number.parseFloat(computed.top) || 0;
        const marginBottom = Number.parseFloat(computed.marginBottom) || 0;
        const navHeight = Math.max(0, Math.ceil(rect.height));
        const navOffset = Math.max(0, Math.ceil(top + navHeight + marginBottom));

        root.style.setProperty('--nav-height', `${navHeight}px`);
        root.style.setProperty('--nav-offset', `${navOffset}px`);
      }
  }});
}
