const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Claude-inspired theme contract', function () {
  it('uses Seraph branding on legacy login, gallery, and WebDAV', function () {
    const legacyLogin = readRepoFile('frontend/pages/login.html');
    const galleryHtml = readRepoFile('frontend/pages/gallery.html');
    const webdavHtml = readRepoFile('frontend/pages/webdav.html');

    assert.match(legacyLogin, /<title>Seraph's Pictures<\/title>/);
    assert.match(legacyLogin, /<h1 class="title">Seraph's Pictures<\/h1>/);
    assert.doesNotMatch(legacyLogin, />K-Vault</);
    assert.match(galleryHtml, /<title>Seraph's Pictures<\/title>/);
    assert.match(webdavHtml, /<title>Seraph's Pictures<\/title>/);
    assert.match(webdavHtml, /alt="Seraph's Pictures Logo"/);
  });

  it('removes the legacy purple-pink gradient from default pages', function () {
    const indexHtml = readRepoFile('frontend/pages/index.html');
    const loginHtml = readRepoFile('frontend/pages/login.html');
    const globalTheme = readRepoFile('frontend/styles/theme.css');
    const legacyTheme = readRepoFile('frontend/styles/claude-theme.css');

    assert.match(globalTheme, /--claude-bg:\s*#1c1b19/);
    assert.match(globalTheme, /--primary-color:\s*var\(--claude-accent\)/);
    assert.match(legacyTheme, /background:\s*var\(--claude-bg\)\s*!important/);

    for (const html of [indexHtml, loginHtml]) {
      assert.match(html, /href="\/claude-theme\.css"/);
      assert.doesNotMatch(html, /#8a4bff/i);
      assert.doesNotMatch(html, /#ffd7e4/i);
      assert.doesNotMatch(html, /#c8f1ff/i);
    }
  });

  it('overrides legacy dark-theme specificity on default pages', function () {
    const legacyTheme = readRepoFile('frontend/styles/claude-theme.css');

    assert.match(legacyTheme, /html\[data-theme="dark"\]\s+body/);
    assert.match(legacyTheme, /html\[data-theme="dark"\]\s+\.header/);
    assert.match(legacyTheme, /html\[data-theme="dark"\]\s+\.card/);
    assert.match(
      legacyTheme,
      /html\[data-theme="dark"\][\s\S]*background:\s*var\(--claude-bg\)\s*!important/
    );
    assert.match(
      legacyTheme,
      /html\[data-theme="dark"\][\s\S]*background:\s*var\(--claude-panel\)\s*!important/
    );
  });
});
