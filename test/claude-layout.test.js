const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readLegacyBundle(relativePath) {
  const shell = readRepoFile(relativePath);
  const refs = [...shell.matchAll(/(?:src|href)="(\/legacy\/[^"?]+\.(?:js|css))/g)]
    .map((match) => match[1].slice(1));
  return [shell, ...refs.map(readRepoFile)].join('\n');
}

describe('Claude layout balance contract', function () {
  it('loads a shared layout balancing stylesheet for legacy pages', function () {
    const indexHtml = readRepoFile('index.html');
    const loginHtml = readRepoFile('login.html');
    const copyLegacy = readRepoFile('scripts/build-static.mjs');

    assert.match(indexHtml, /href="\/claude-layout\.css"/);
    assert.match(loginHtml, /href="\/claude-layout\.css"/);
    assert.match(copyLegacy, /'claude-layout\.css'/);
  });

  it('loads a scoped admin layout stylesheet for the management page', function () {
    const adminHtml = readRepoFile('admin.html');
    const copyLegacy = readRepoFile('scripts/build-static.mjs');

    assert.match(adminHtml, /href="\/claude-admin-layout\.css\?v=20260611-grid-pagination"/);
    assert.match(adminHtml, /href="\/seraph-admin-polish\.css\?v=20260611-grid-pagination"/);
    assert.match(copyLegacy, /'claude-admin-layout\.css'/);
  });

  it('centers and evenly splits the legacy upload interface', function () {
    const layout = readRepoFile('claude-layout.css');

    assert.match(layout, /#app[\s\S]*margin-inline:\s*auto\s*!important/);
    assert.match(layout, /\.main-container[\s\S]*margin:\s*0 auto\s*!important/);
    assert.match(
      layout,
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)\s*!important/
    );
    assert.match(layout, /\.upload-methods[\s\S]*grid-template-columns:\s*repeat\(3,/);
  });

  it('keeps the legacy login surface centered', function () {
    const legacyLayout = readRepoFile('claude-layout.css');

    assert.match(legacyLayout, /body\.login-page[\s\S]*place-items:\s*center\s*!important/);
    assert.match(legacyLayout, /\.login-container[\s\S]*margin-inline:\s*auto\s*!important/);
  });

  it('keeps record totals in the folder sidebar outside page navigation', function () {
    const admin = readLegacyBundle('admin.html');
    const layout = readRepoFile('claude-admin-layout.css');
    const header = admin.match(/<div class="header-content admin-navigation">[\s\S]*?<\/el-header>/)?.[0] || '';
    const sidebar = admin.match(/<aside class="folder-sidebar">[\s\S]*?<\/aside>/)?.[0] || '';

    assert.match(admin, /<body class="admin-page">/);
    assert.doesNotMatch(header, /class="stats"/);
    assert.match(sidebar, /class="folder-stats"/);
    assert.match(sidebar, /\{\{\s*t\('admin\.totalRecords'\)\s*\}\}\s*\{\{\s*totalCount\s*\|\|\s*Number\s*\}\}/);
    assert.ok(header, 'the navigation header must be present');
    assert.doesNotMatch(header, /class="status-panel"/);
    assert.doesNotMatch(layout, /\.status-panel/);
    assert.match(layout, /\.main-container[\s\S]*display:\s*block\s*!important/);
    assert.match(layout, /\.folder-stats[\s\S]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/);
    assert.match(
      layout,
      /\.admin-page\s+\.disk-layout[\s\S]*grid-template-columns:\s*320px\s+minmax\(0,\s*1fr\)\s*!important/
    );
    assert.match(
      layout,
      /\.disk-layout\.is-list-view[\s\S]*grid-template-columns:\s*320px\s+minmax\(560px,\s*720px\)\s+320px\s*!important/
    );
    assert.match(layout, /\.folder-sidebar[\s\S]*grid-column:\s*1\s*!important/);
    assert.match(layout, /\.disk-content[\s\S]*justify-self:\s*stretch\s*!important/);
    assert.match(admin, /<div class="disk-layout"\s+:class="\{\s*'is-list-view':\s*viewMode\s*===\s*'list'\s*\}">/);
    assert.match(admin, /<section class="disk-content"\s+:class="\{\s*'is-list-view':\s*viewMode\s*===\s*'list'\s*\}">/);
    assert.match(layout, /\.disk-content\.is-list-view[\s\S]*grid-column:\s*2\s*\/\s*4\s*!important/);
    assert.match(layout, /\.disk-content\.is-list-view[\s\S]*justify-self:\s*start\s*!important/);
    assert.match(layout, /\.folder-breadcrumb,[\s\S]*\.admin-page\s+\.empty-tip[\s\S]*width:\s*min\(560px,\s*100%\)\s*!important/);
    assert.match(layout, /\.disk-content\.is-list-view\s+\.folder-breadcrumb[\s\S]*margin-left:\s*0\s*!important/);
    assert.match(layout, /\.disk-content\.is-list-view\s+\.list-view-card[\s\S]*width:\s*min\(1180px,\s*calc\(100vw\s*-\s*420px\)\)\s*!important/);
    assert.match(layout, /\.disk-content\.is-list-view\s+\.list-view-card[\s\S]*margin-left:\s*0\s*!important/);
    assert.match(layout, /\.disk-content\.is-list-view\s+\.list-view-card[\s\S]*overflow-x:\s*auto\s*!important/);
    assert.match(layout, /\.list-view-card\s+\.el-table[\s\S]*min-width:\s*1100px\s*!important/);
    assert.match(layout, /\.folder-breadcrumb,[\s\S]*\.admin-page\s+\.empty-tip,[\s\S]*\.admin-page\s+\.content[\s\S]*box-sizing:\s*border-box\s*!important/);
    assert.match(layout, /\.content[\s\S]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(300px,\s*1fr\)\)\s*!important/);
    assert.match(layout, /\.content[\s\S]*grid-auto-flow:\s*row\s*!important/);
    assert.match(layout, /\.content[\s\S]*padding:\s*0\s*!important/);
    assert.match(layout, /\.pagination-container[\s\S]*position:\s*fixed\s*!important/);
    assert.match(layout, /\.pagination-container[\s\S]*left:\s*50%\s*!important/);
    assert.doesNotMatch(admin, /load-more-end/);
    assert.doesNotMatch(admin, /全部加载完成/);
    assert.match(layout, /\.empty-tip[\s\S]*display:\s*grid\s*!important/);
    assert.match(layout, /\.empty-tip[\s\S]*place-items:\s*center\s*!important/);
  });

  it('brands the legacy upload page for Seraph and uses icon-only theme switching', function () {
    const indexHtml = readLegacyBundle('index.html');
    const layout = readRepoFile('seraph-ui-polish.css');

    assert.match(indexHtml, /<title>Seraph's Pictures<\/title>/);
    assert.match(indexHtml, /alt="Seraph's Pictures Logo"/);
    assert.match(indexHtml, /<span class="brand-name">Seraph's Pictures<\/span>/);
    assert.match(indexHtml, /class="theme-toggle-btn header-theme-toggle theme-icon-only"/);
    assert.match(indexHtml, /class="nav-link is-active" aria-current="page"><i class="fas fa-home"><\/i> \{\{ t\('nav\.home'\) \}\}/);
    assert.doesNotMatch(indexHtml, /class="logout-link"/);
    assert.doesNotMatch(indexHtml, /data-theme-label/);
    assert.match(layout, /\.theme-icon-only[\s\S]*aspect-ratio:\s*1/);
    assert.match(layout, /\.nav-links a\.is-active[\s\S]*box-shadow:/);

    const themeIndex = indexHtml.indexOf('class="theme-toggle-btn header-theme-toggle theme-icon-only"');
    const navIndex = indexHtml.indexOf('class="nav-links"');
    const galleryIndex = indexHtml.indexOf("t('nav.gallery')");
    const webdavIndex = indexHtml.indexOf("t('nav.webdav')");
    const adminIndex = indexHtml.indexOf("t('nav.admin')");

    assert.ok(navIndex < themeIndex, 'theme toggle should render after navigation');
    assert.ok(galleryIndex < webdavIndex, 'gallery should render before WebDAV');
    assert.ok(webdavIndex < adminIndex, 'admin should render after WebDAV');
  });

  it('sends guest upload brand logo clicks to login without changing other brand navigation', function () {
    const indexHtml = readLegacyBundle('index.html');
    const themeJs = readRepoFile('theme.js');

    assert.match(indexHtml, /class="brand-logo"[\s\S]*data-brand-home="1"[\s\S]*@click\.stop="handleBrandLogoClick"/);
    assert.match(indexHtml, /handleBrandLogoClick\(\)[\s\S]*this\.isGuest[\s\S]*\/login\?redirect=/);
    assert.match(indexHtml, /handleBrandLogoClick\(\)[\s\S]*window\.location\.href = "\/"/);
    assert.match(themeJs, /img\.addEventListener\("click"[\s\S]*window\.location\.href = "\/"/);
    assert.doesNotMatch(indexHtml, /class="brand-logo-link"/);
  });

  it('keeps upload results and uploaded file cards evenly sized as content grows', function () {
    const indexHtml = readRepoFile('index.html');
    const layout = readRepoFile('seraph-ui-polish.css');
    const copyLegacy = readRepoFile('scripts/build-static.mjs');

    assert.match(indexHtml, /href="\/seraph-ui-polish\.css"/);
    assert.match(copyLegacy, /'seraph-ui-polish\.css'/);
    assert.match(layout, /\.upload-list[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
    assert.match(layout, /\.upload-item,[\s\S]*\.result-item[\s\S]*min-height:\s*96px/);
    assert.match(layout, /\.result-list[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
    assert.match(layout, /\.result-section[\s\S]*align-self:\s*stretch/);
  });

  it('separates page navigation from file controls and keeps settings accessible', function () {
    const adminHtml = readLegacyBundle('admin.html');
    const layout = readRepoFile('legacy/pages/admin/styles/file-navigation.css');
    const copyLegacy = readRepoFile('scripts/build-static.mjs');

    assert.match(adminHtml, /href="\/seraph-admin-polish\.css\?v=20260611-grid-pagination"/);
    assert.match(copyLegacy, /'seraph-admin-polish\.css'/);
    assert.match(adminHtml, /<nav class="admin-primary-nav"/);
    assert.match(adminHtml, /href="\/admin" aria-current="page"/);
    assert.match(adminHtml, /class="admin-file-controls"/);
    assert.match(adminHtml, /class="admin-header-system"/);
    assert.match(adminHtml, /showStorageConfigPanel/);
    assert.doesNotMatch(adminHtml, /<el-dropdown @command="handleWebsite">/);
    assert.doesNotMatch(adminHtml, /fa-external-link-alt/);
    assert.doesNotMatch(adminHtml, /quickWebsites/);
    assert.doesNotMatch(adminHtml, /handleWebsite/);
    assert.doesNotMatch(adminHtml, /admin\.quickLinkInternalOnly/);
    assert.doesNotMatch(adminHtml, /Movavi|FreeConvert|YouCompress|Cloudinary/);
    assert.doesNotMatch(adminHtml, /editWebsites|编辑快捷方式/);
    assert.doesNotMatch(adminHtml, /window\.open\(url, '_blank'\)/);
    assert.doesNotMatch(adminHtml, /command="uiDesign"/);
    assert.match(layout, /\.admin-primary-nav/);
    assert.match(layout, /\.admin-file-controls/);
    assert.match(layout, /:focus-visible/);
    assert.doesNotMatch(adminHtml, /:class="\{ disabled: selectedFiles.length === 0 \}"/);
  });

  it('shows storage status dialog without config navigation actions', function () {
    const adminHtml = readLegacyBundle('admin.html');

    assert.match(adminHtml, /'admin\.storageStatusTitle': 'Storage Status'/);
    assert.doesNotMatch(adminHtml, /Storage Status & Config/);
    assert.doesNotMatch(adminHtml, /admin\.openConfigPanel/);
    assert.doesNotMatch(adminHtml, /admin\.openDiagPanel/);
    assert.doesNotMatch(adminHtml, /storage-config-actions/);
    assert.doesNotMatch(adminHtml, /href="\/app\/storage"/);
    assert.doesNotMatch(adminHtml, /href="\/app\/status"/);
    assert.match(adminHtml, /confirmButtonText:\s*this\.t\('admin\.close'\)/);
    assert.match(adminHtml, /\.storage-config-alert\s+\.el-message-box__title[\s\S]*text-align:\s*center/);
    assert.match(adminHtml, /\.storage-config-alert\s+\.el-message-box__btns[\s\S]*justify-content:\s*center/);
  });

  it('centers UI design dialog controls and removes old project footer branding', function () {
    const adminHtml = readLegacyBundle('admin.html');
    const layout = readRepoFile('seraph-admin-polish.css');

    assert.doesNotMatch(adminHtml, />Powered By K-Vault</);
    assert.doesNotMatch(adminHtml, />K-Vault<\/div>/);
    assert.match(adminHtml, /ui-design-action-grid/);
    assert.match(adminHtml, /ui-design-footer-actions/);
    assert.match(adminHtml, /ui-effect-grid/);
    assert.match(adminHtml, /\.ui-design-alert\s+\.el-message-box__header[\s\S]*text-align:\s*center/);
    assert.match(adminHtml, /\.ui-design-alert\s+\.el-message-box__title[\s\S]*justify-content:\s*center/);
    assert.match(adminHtml, /class="ui-design-foot ui-design-reset-foot"[\s\S]*id="uiResetDefaults"/);
    assert.match(adminHtml, /\.ui-design-reset-foot[\s\S]*justify-items:\s*center/);
    assert.match(layout, /\.ui-design-panel[\s\S]*text-align:\s*center/);
    assert.match(layout, /\.ui-design-action-grid[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(layout, /\.ui-effect-grid[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(layout, /\.ui-effect-grid[\s\S]*align-items:\s*stretch/);
    assert.match(layout, /\.ui-effect-grid\s+\.ui-segment[\s\S]*height:\s*100%/);
    assert.match(layout, /\.ui-design-footer-actions[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});
