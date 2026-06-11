const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Claude-inspired theme contract', function () {
  it('uses warm dark Claude-style tokens in the Vue app theme', function () {
    const main = readRepoFile('frontend/src/main.js');
    const styles = readRepoFile('frontend/src/claude-theme.css');

    assert.match(main, /import '\.\/claude-theme\.css';/);
    assert.match(styles, /--claude-bg:\s*#1f1f1d/);
    assert.match(styles, /--claude-accent:\s*#d97757/);
    assert.match(styles, /font-family:\s*"Inter", "SF Pro Text"/);
    assert.doesNotMatch(styles, /#8a4bff/i);
    assert.doesNotMatch(styles, /#ffd7e4/i);
    assert.doesNotMatch(styles, /#c8f1ff/i);
  });

  it('renders the Vue login page as a Claude-style prompt surface', function () {
    const loginView = readRepoFile('frontend/src/views/LoginView.vue');

    assert.match(loginView, /claude-login-page/);
    assert.match(loginView, /claude-mark/);
    assert.match(loginView, /Welcome, Seraph/);
    assert.match(loginView, /Seraph's Pictures private workspace/);
    assert.doesNotMatch(loginView, />K-Vault private workspace</);
    assert.match(loginView, /class="claude-login-box"/);
  });

  it('uses Seraph branding on legacy login and the optional Vue shell', function () {
    const legacyLogin = readRepoFile('login.html');
    const galleryHtml = readRepoFile('gallery.html');
    const webdavHtml = readRepoFile('webdav.html');
    const appShell = readRepoFile('frontend/src/components/AppShell.vue');
    const appIndex = readRepoFile('frontend/index.html');

    assert.match(legacyLogin, /<title>登录 \| Seraph's Pictures<\/title>/);
    assert.match(legacyLogin, /<h1 class="title">Seraph's Pictures<\/h1>/);
    assert.doesNotMatch(legacyLogin, />K-Vault</);
    assert.match(galleryHtml, /<title>图片浏览器 \| Seraph's Pictures<\/title>/);
    assert.match(webdavHtml, /<title>WebDAV 上传中心 \| Seraph's Pictures<\/title>/);
    assert.match(webdavHtml, /alt="Seraph's Pictures Logo"/);
    assert.match(appShell, /<h1>Seraph's Pictures<\/h1>/);
    assert.doesNotMatch(appShell, /<h1>K-Vault<\/h1>/);
    assert.match(appIndex, /<title>Seraph's Pictures App<\/title>/);
  });

  it('removes the legacy purple-pink gradient from default pages', function () {
    const indexHtml = readRepoFile('index.html');
    const loginHtml = readRepoFile('login.html');
    const legacyTheme = readRepoFile('claude-theme.css');

    assert.match(legacyTheme, /--claude-bg:\s*#1f1f1d/);
    assert.match(legacyTheme, /--primary-color:\s*var\(--claude-accent\)/);

    for (const html of [indexHtml, loginHtml]) {
      assert.match(html, /href="\/claude-theme\.css"/);
      assert.doesNotMatch(html, /#8a4bff/i);
      assert.doesNotMatch(html, /#ffd7e4/i);
      assert.doesNotMatch(html, /#c8f1ff/i);
    }
  });

  it('overrides legacy dark-theme specificity on default pages', function () {
    const legacyTheme = readRepoFile('claude-theme.css');

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
