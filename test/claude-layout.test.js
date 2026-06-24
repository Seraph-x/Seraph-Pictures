const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Claude layout balance contract', function () {
  it('loads a shared layout balancing stylesheet for legacy pages', function () {
    const indexHtml = readRepoFile('index.html');
    const loginHtml = readRepoFile('login.html');
    const copyLegacy = readRepoFile('frontend/scripts/copy-legacy.mjs');

    assert.match(indexHtml, /href="\/claude-layout\.css"/);
    assert.match(loginHtml, /href="\/claude-layout\.css"/);
    assert.match(copyLegacy, /'claude-layout\.css'/);
  });

  it('loads a scoped admin layout stylesheet for the management page', function () {
    const adminHtml = readRepoFile('admin.html');
    const copyLegacy = readRepoFile('frontend/scripts/copy-legacy.mjs');

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

  it('keeps login surfaces centered in both legacy and Vue entrypoints', function () {
    const legacyLayout = readRepoFile('claude-layout.css');
    const vueLayout = readRepoFile('frontend/src/claude-layout.css');
    const main = readRepoFile('frontend/src/main.js');

    assert.match(legacyLayout, /body\.login-page[\s\S]*place-items:\s*center\s*!important/);
    assert.match(legacyLayout, /\.login-container[\s\S]*margin-inline:\s*auto\s*!important/);
    assert.match(main, /import\('\.\/claude-layout\.css'\)/);
    assert.match(vueLayout, /\.app-bg[\s\S]*margin:\s*16px auto 40px\s*!important/);
    assert.match(vueLayout, /\.claude-login-page[\s\S]*place-items:\s*center/);
    assert.match(vueLayout, /\.claude-login-shell[\s\S]*margin:\s*auto/);
  });

  it('keeps the admin toolbar single-line and moves record totals into the folder sidebar', function () {
    const admin = readRepoFile('admin.html');
    const layout = readRepoFile('claude-admin-layout.css');
    const header = admin.match(/<div class="header-content">[\s\S]*?<\/el-header>/)?.[0] || '';
    const sidebar = admin.match(/<aside class="folder-sidebar">[\s\S]*?<\/aside>/)?.[0] || '';

    assert.match(admin, /<body class="admin-page">/);
    assert.doesNotMatch(header, /class="stats"/);
    assert.match(sidebar, /class="folder-stats"/);
    assert.match(sidebar, /\{\{\s*t\('admin\.totalRecords'\)\s*\}\}\s*\{\{\s*totalCount\s*\|\|\s*Number\s*\}\}/);
    assert.match(layout, /\.admin-page\s+\.header-content[\s\S]*flex-wrap:\s*nowrap\s*!important/);
    assert.match(layout, /\.header-content\s+\.actions[\s\S]*justify-content:\s*flex-end\s*!important/);
    assert.match(layout, /\.header-content\s+\.actions[\s\S]*flex-wrap:\s*nowrap\s*!important/);
    assert.match(layout, /\.header-content\s+\.actions\s+>\s+\*[\s\S]*order:\s*0\s*!important/);
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
    const indexHtml = readRepoFile('index.html');
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

  it('keeps the upload brand logo on the original click path while guests go to login', function () {
    const indexHtml = readRepoFile('index.html');
    const themeJs = readRepoFile('theme.js');

    assert.doesNotMatch(indexHtml, /class="brand-logo-link"/);
    assert.match(indexHtml, /class="brand-logo"[\s\S]*@click\.stop="handleBrandLogoClick"/);
    assert.match(indexHtml, /data-brand-home="1"/);
    assert.match(indexHtml, /handleBrandLogoClick\(\)[\s\S]*this\.isGuest[\s\S]*\/login\.html\?redirect=/);
    assert.match(indexHtml, /handleBrandLogoClick\(\)[\s\S]*window\.location\.href = "\/"/);
    assert.match(themeJs, /img\.addEventListener\("click"[\s\S]*window\.location\.href = "\/"/);
  });

  it('keeps upload results and uploaded file cards evenly sized as content grows', function () {
    const indexHtml = readRepoFile('index.html');
    const layout = readRepoFile('seraph-ui-polish.css');
    const copyLegacy = readRepoFile('frontend/scripts/copy-legacy.mjs');

    assert.match(indexHtml, /href="\/seraph-ui-polish\.css"/);
    assert.match(copyLegacy, /'seraph-ui-polish\.css'/);
    assert.match(layout, /\.upload-list[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
    assert.match(layout, /\.upload-item,[\s\S]*\.result-item[\s\S]*min-height:\s*96px/);
    assert.match(layout, /\.result-list[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/);
    assert.match(layout, /\.result-section[\s\S]*align-self:\s*stretch/);
  });

  it('splits the admin header into balanced control groups and adds storage configuration access', function () {
    const adminHtml = readRepoFile('admin.html');
    const layout = readRepoFile('seraph-admin-polish.css');
    const copyLegacy = readRepoFile('frontend/scripts/copy-legacy.mjs');

    assert.match(adminHtml, /href="\/seraph-admin-polish\.css\?v=20260611-grid-pagination"/);
    assert.match(copyLegacy, /'seraph-admin-polish\.css'/);
    assert.match(adminHtml, /class="admin-header-primary"/);
    assert.match(adminHtml, /class="actions admin-header-tools"/);
    assert.match(adminHtml, /class="admin-header-system"/);
    assert.match(adminHtml, /showStorageConfigPanel/);
    assert.match(adminHtml, /name: \(window\.I18n \? I18n\.t\('admin\.toolkitOpenUploader'\) : '打开上传中心'\), url: '\/'/);
    assert.match(adminHtml, /name: \(window\.I18n \? I18n\.t\('nav\.gallery'\) : '图片浏览'\), url: '\/gallery\.html'/);
    assert.match(adminHtml, /window\.location\.href = target/);
    assert.doesNotMatch(adminHtml, /Movavi|FreeConvert|YouCompress|Cloudinary/);
    assert.doesNotMatch(adminHtml, /editWebsites|编辑快捷方式/);
    assert.doesNotMatch(adminHtml, /window\.open\(url, '_blank'\)/);
    assert.doesNotMatch(adminHtml, /command="uiDesign"/);
    assert.match(layout, /\.admin-page\s+\.header-content[\s\S]*display:\s*grid\s*!important/);
    assert.match(layout, /grid-template-columns:\s*minmax\(300px,\s*0\.85fr\)\s+minmax\(520px,\s*1\.45fr\)\s+minmax\(160px,\s*0\.45fr\)\s*!important/);
    assert.match(layout, /\.admin-header-tools[\s\S]*justify-content:\s*center\s*!important/);
    assert.match(layout, /\.admin-header-system[\s\S]*justify-content:\s*end\s*!important/);
    assert.match(layout, /\.admin-header-system[\s\S]*gap:\s*12px\s*!important/);
    assert.doesNotMatch(layout, /\.admin-header-system\s+\.status-panel/);
    assert.match(layout, /@media\s*\(max-width:\s*1180px\)[\s\S]*grid-template-columns:\s*1fr\s*!important/);
  });

  it('centers UI design dialog controls and removes old project footer branding', function () {
    const adminHtml = readRepoFile('admin.html');
    const layout = readRepoFile('seraph-admin-polish.css');

    assert.doesNotMatch(adminHtml, />Powered By K-Vault</);
    assert.doesNotMatch(adminHtml, />K-Vault<\/div>/);
    assert.match(adminHtml, /ui-design-action-grid/);
    assert.match(adminHtml, /ui-design-footer-actions/);
    assert.match(adminHtml, /ui-effect-grid/);
    assert.match(layout, /\.ui-design-panel[\s\S]*text-align:\s*center/);
    assert.match(layout, /\.ui-design-action-grid[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(layout, /\.ui-effect-grid[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(layout, /\.ui-effect-grid[\s\S]*align-items:\s*stretch/);
    assert.match(layout, /\.ui-effect-grid\s+\.ui-segment[\s\S]*height:\s*100%/);
    assert.match(layout, /\.ui-design-footer-actions[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });
});
