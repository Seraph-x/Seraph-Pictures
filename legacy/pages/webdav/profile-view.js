{
  'use strict';

  function selectedProfile(state) {
    return state.profiles.find((profile) => profile.id === state.selectedId) || null;
  }

  function profileNotice(state, t) {
    if (state.phase === 'loading') return t('webdav.loadingProfiles');
    if (state.phase === 'empty') return t('webdav.noWebdavProfiles');
    if (state.phase === 'error') return t('webdav.profileLoadFailed', { detail: state.error });
    if (state.notice) return t('webdav.selectionReset');
    return '';
  }

  function connectionText(state, t) {
    const connection = state.connection || {};
    const name = selectedProfile(state)?.name || '';
    if (connection.phase === 'checking') return t('webdav.checkingProfile', { name });
    if (connection.phase === 'error') {
      return t('webdav.unavailableProfile', { name, detail: connection.error });
    }
    if (connection.phase !== 'ready') return t('webdav.waiting');
    if (connection.result?.connected) return t('webdav.connectedProfile', { name });
    return t('webdav.unavailableProfile', {
      name, detail: connection.result?.message || t('webdav.unknownError'),
    });
  }

  class WebdavProfileView {
    constructor(options) {
      this.elements = options.elements;
      this.t = options.t;
      this.state = null;
      this.busy = false;
    }

    bind(actions) {
      this.elements.select.addEventListener('change', (event) => actions.onSelect(event.target.value));
      this.elements.refreshButton.addEventListener('click', () => actions.onRefresh());
    }

    render(state) {
      this.state = state;
      this.renderOptions(state);
      this.elements.notice.textContent = profileNotice(state, this.t);
      this.elements.notice.hidden = !this.elements.notice.textContent;
      this.elements.connection.textContent = connectionText(state, this.t);
      this.syncButtons();
    }

    renderOptions(state) {
      const options = state.profiles.map((profile) => {
        const option = this.elements.select.ownerDocument.createElement('option');
        option.value = profile.id;
        const suffix = profile.isDefault ? this.t('webdav.defaultSuffix') : '';
        option.textContent = `${profile.name}${suffix}`;
        return option;
      });
      this.elements.select.replaceChildren(...options);
      this.elements.select.value = state.selectedId;
      this.elements.select.disabled = state.phase !== 'ready';
    }

    setUploadBusy(busy) {
      this.busy = Boolean(busy);
      this.syncButtons();
    }

    syncButtons() {
      const unavailable = !this.state?.canUpload;
      this.elements.fileButton.disabled = this.busy || unavailable;
      this.elements.urlButton.disabled = this.busy || unavailable;
      this.elements.refreshButton.disabled = !this.state?.selectedId
        || this.state?.connection?.phase === 'checking';
    }
  }

  function createView(options) {
    return new WebdavProfileView(options);
  }

  const profileView = Object.freeze({ createView });
  if (typeof module === 'object' && module.exports) module.exports = profileView;
  globalThis.LegacyWebdavProfileView = profileView;
}
