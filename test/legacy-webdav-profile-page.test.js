const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'webdav.html'), 'utf8');
let viewModule = null;
try {
  viewModule = require('../legacy/pages/webdav/profile-view.js');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function fakeElement() {
  const listeners = {};
  const element = {
    children: [], value: '', textContent: '', disabled: false, hidden: false,
    addEventListener: (type, callback) => { listeners[type] = callback; },
    emit: (type) => listeners[type]?.({ target: element }),
    replaceChildren(...children) { this.children = children; },
    ownerDocument: { createElement: () => ({ value: '', textContent: '', disabled: false }) },
  };
  return element;
}

function elements() {
  return {
    select: fakeElement(), notice: fakeElement(), connection: fakeElement(),
    fileButton: fakeElement(), urlButton: fakeElement(), refreshButton: fakeElement(),
  };
}

function translator(key, params = {}) {
  return `${key}:${params.name || params.detail || ''}`;
}

function readyState(connection = { phase: 'idle', profileId: '', result: null, error: '' }) {
  return Object.freeze({
    phase: 'ready', selectedId: 'dav-main', notice: '', error: '', canUpload: true,
    profiles: Object.freeze([
      Object.freeze({ id: 'dav-main', name: 'Main DAV', isDefault: true }),
      Object.freeze({ id: 'dav-backup', name: 'Backup DAV', isDefault: false }),
    ]),
    connection,
  });
}

describe('legacy WebDAV profile selector page contract', function () {
  it('places the target between the left status group and right actions', function () {
    const left = HTML.indexOf('class="toolbar-left"');
    const target = HTML.indexOf('id="webdavProfileTarget"');
    const right = HTML.indexOf('class="toolbar-right"');
    assert.ok(left >= 0 && left < target && target < right);
    assert.match(HTML, /id="webdavProfileSelect"/);
    assert.match(HTML, /id="webdavProfileNotice"/);
  });

  it('loads profile dependencies in order before the inline page script', function () {
    const dependencies = [
      '/legacy/storage/api.js', '/legacy/pages/upload/profile-mixin.js',
      '/legacy/pages/webdav/profile-controller.js', '/legacy/pages/webdav/profile-view.js',
      '/legacy/pages/webdav/upload-actions.js',
    ];
    const positions = dependencies.map((entry) => HTML.indexOf(entry));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.ok(positions.at(-1) < HTML.indexOf('<script>\n      (function ()'));
  });

  it('defines bilingual selector and connection copy', function () {
    for (const key of [
      'targetLabel', 'defaultSuffix', 'loadingProfiles', 'noWebdavProfiles',
      'profileLoadFailed', 'selectionReset', 'checkingProfile',
      'connectedProfile', 'unavailableProfile',
    ]) {
      const entries = HTML.match(new RegExp(`"webdav\\.${key}"\\s*:`, 'g')) || [];
      assert.equal(entries.length, 2, `${key} should exist in zh and en`);
    }
  });

  it('re-renders JavaScript-built profile copy when language changes', function () {
    assert.match(HTML, /I18n\.onChange[\s\S]*profileView\.render\(profileController\.getState\(\)\)/);
  });

  it('defines a flexible desktop target and a full-row narrow layout', function () {
    const cssPath = path.join(ROOT, 'legacy/pages/webdav/profile.css');
    assert.equal(fs.existsSync(cssPath), true);
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.match(css, /\.webdav-profile-target\s*\{[\s\S]*flex:\s*1/);
    assert.match(css, /@media[^\{]*max-width:[^\{]*\{[\s\S]*\.webdav-profile-target\s*\{[\s\S]*flex-basis:\s*100%/);
    const narrow = css.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*)\}\s*$/)?.[1] || '';
    assert.match(narrow, /\.webdav-profile-target\s*\{[\s\S]*width:\s*100%/);
  });

  it('mounts the profile API after authentication and refreshes the selected profile', function () {
    assert.doesNotMatch(HTML, /request\("\/api\/status"\)/);
    const auth = HTML.indexOf('var authenticated = await ensureAuth()');
    const initialize = HTML.indexOf('await initializeProfileSelector()', auth);
    assert.ok(auth >= 0 && initialize > auth);
    assert.match(HTML, /LegacyStorageApi\.createStorageApi\(\)/);
    assert.match(HTML, /LegacyWebdavProfiles\.createController/);
    assert.match(HTML, /LegacyWebdavProfileView\.createView/);
    assert.match(HTML, /profileController\.load\(\)/);
    assert.match(HTML, /onRefresh:\s*function \(\) \{\s*return profileController\.refresh\(\)/);
  });

  it('separates operation notices from the connection detail card', function () {
    assert.match(HTML, /function setOperationStatus\(message, ok\)/);
    const operation = HTML.match(/function setOperationStatus\(message, ok\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
    assert.match(operation, /statusText\.textContent = message/);
    assert.doesNotMatch(operation, /statusDetailText/);
  });

  it('delegates file and URL requests to the tested upload coordinator', function () {
    assert.match(HTML, /LegacyWebdavUploadActions\.createUploadActions/);
    assert.match(HTML, /uploadActions\.uploadFiles\(files, folderPath\)/);
    assert.match(HTML, /uploadActions\.uploadUrl\(sourceUrl, folderPath\)/);
  });

  it('keeps both upload actions disabled until profiles finish loading', function () {
    assert.match(HTML, /id="uploadFilesBtn"[^>]*disabled/);
    assert.match(HTML, /id="uploadUrlBtn"[^>]*disabled/);
  });
});

describe('legacy WebDAV profile selector view', function () {
  it('disables uploads and reports an empty profile list', function () {
    assert.ok(viewModule, 'WebDAV profile view module should exist');
    const refs = elements();
    const view = viewModule.createView({ elements: refs, t: translator });
    view.render({
      phase: 'empty', profiles: [], selectedId: '', canUpload: false,
      notice: '', error: '', connection: { phase: 'idle' },
    });
    assert.equal(refs.fileButton.disabled, true);
    assert.equal(refs.urlButton.disabled, true);
    assert.match(refs.notice.textContent, /noWebdavProfiles/);
  });

  it('renders the selected profile and localized default suffix', function () {
    assert.ok(viewModule, 'WebDAV profile view module should exist');
    const refs = elements();
    const view = viewModule.createView({ elements: refs, t: translator });
    view.render(readyState());
    assert.equal(refs.select.value, 'dav-main');
    assert.equal(refs.select.children.length, 2);
    assert.match(refs.select.children[0].textContent, /defaultSuffix/);
    assert.doesNotMatch(refs.select.children[1].textContent, /defaultSuffix/);
  });

  it('keeps connection copy separate and combines availability with upload busy state', function () {
    assert.ok(viewModule, 'WebDAV profile view module should exist');
    const refs = elements();
    const view = viewModule.createView({ elements: refs, t: translator });
    view.render(readyState({
      phase: 'ready', profileId: 'dav-main', result: { connected: true }, error: '',
    }));
    assert.match(refs.connection.textContent, /connectedProfile:Main DAV/);
    view.setUploadBusy(true);
    assert.equal(refs.fileButton.disabled, true);
    assert.equal(refs.urlButton.disabled, true);
    assert.match(refs.connection.textContent, /connectedProfile/);
  });

  it('does not label a previous profile connection as the current selection', function () {
    const refs = elements();
    const view = viewModule.createView({ elements: refs, t: translator });
    view.render(readyState({
      phase: 'ready', profileId: 'dav-backup', result: { connected: true }, error: '',
    }));
    assert.match(refs.connection.textContent, /waiting/);
    assert.doesNotMatch(refs.connection.textContent, /connectedProfile/);
  });

  it('binds selection and refresh events without issuing requests itself', async function () {
    assert.ok(viewModule, 'WebDAV profile view module should exist');
    const refs = elements();
    const events = [];
    const view = viewModule.createView({ elements: refs, t: translator });
    view.bind({
      onSelect: (id) => events.push(`select:${id}`),
      onRefresh: () => events.push('refresh'),
    });
    refs.select.value = 'dav-backup';
    refs.select.emit('change');
    refs.refreshButton.emit('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ['select:dav-backup', 'refresh']);
  });

  it('reports rejected profile actions through one explicit error handler', async function () {
    const refs = elements();
    const errors = [];
    const view = viewModule.createView({ elements: refs, t: translator });
    view.bind({
      onSelect: async () => { throw new Error('MEMORY_WRITE_FAILED'); },
      onRefresh: () => { throw new Error('REFRESH_FAILED'); },
      onError: (error) => errors.push(error.message),
    });
    refs.select.emit('change');
    refs.refreshButton.emit('click');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors.sort(), ['MEMORY_WRITE_FAILED', 'REFRESH_FAILED']);
  });
});
