const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distIndexPath = path.join(repoRoot, 'frontend', 'dist', 'index.html');
const distAdminPath = path.join(repoRoot, 'frontend', 'dist', 'admin.html');
const appIndexPath = path.join(repoRoot, 'frontend', 'dist', 'app', 'index.html');
const redirectsPath = path.join(repoRoot, 'frontend', 'dist', '_redirects');
const webdavPath = path.join(repoRoot, 'frontend', 'dist', 'webdav.html');
const legacyIndexPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'index.html');
const legacyAdminPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'admin.html');
const legacyWebdavPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'webdav.html');
const sourceIndexPath = path.join(repoRoot, 'index.html');
const sourceAdminPath = path.join(repoRoot, 'admin.html');
const sourceGalleryPath = path.join(repoRoot, 'gallery.html');
const sourceWebdavPath = path.join(repoRoot, 'webdav.html');
const appShellPath = path.join(repoRoot, 'frontend', 'src', 'components', 'AppShell.vue');
const appDeepLinks = ['login', 'drive', 'admin', 'storage', 'status'];
const extensionfulLegacyNavigation = /(?:href=|url: |window\.location\.(?:href|replace)\s*=\s*)['"]\/(?:gallery|admin|webdav|login|storage-settings)\.html\b/;

function readDistFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

describe('frontend Pages entrypoint', function () {
  it('serves the legacy upload page at the site root', function () {
    const indexHtml = readDistFile(distIndexPath);

    assert.match(indexHtml, /<title>Seraph's Pictures<\/title>/);
    assert.match(indexHtml, /class="upload-zone"/);
    assert.doesNotMatch(indexHtml, /<title>Seraph's Pictures App<\/title>/);
    assert.doesNotMatch(indexHtml, /Upload files, manage folders/);
    assert.doesNotMatch(indexHtml, /Start Uploading/);
  });

  it('keeps API upload and legacy routes separate from the optional Vue app', function () {
    const redirects = readDistFile(redirectsPath);
    const appIndexHtml = readDistFile(appIndexPath);

    assert.doesNotMatch(redirects, /^\/upload\s+/m);
    assert.match(redirects, /^\/app\s+\/app\/index\.html\s+200$/m);
    assert.match(redirects, /^\/app\/\*\s+\/app\/index\.html\s+200$/m);
    assert.doesNotMatch(redirects, /^\/drive\s+\/index\.html\s+200$/m);
    assert.doesNotMatch(redirects, /^\/status\s+\/index\.html\s+200$/m);
    assert.match(appIndexHtml, /<title>Seraph's Pictures App<\/title>/);
    assert.match(appIndexHtml, /\/app\/assets\//);
  });

  it('emits physical Vue app entry files for Cloudflare extensionless deep links', function () {
    const appIndexHtml = readDistFile(appIndexPath);

    for (const route of appDeepLinks) {
      const routeIndexPath = path.join(repoRoot, 'frontend', 'dist', 'app', route, 'index.html');
      const routeHtmlPath = path.join(repoRoot, 'frontend', 'dist', 'app', `${route}.html`);
      assert.ok(fs.existsSync(routeIndexPath), `/app/${route}/index.html should exist`);
      assert.ok(fs.existsSync(routeHtmlPath), `/app/${route}.html should exist`);
      assert.strictEqual(readDistFile(routeIndexPath), appIndexHtml);
      assert.strictEqual(readDistFile(routeHtmlPath), appIndexHtml);
    }
  });

  it('keeps the legacy WebDAV entrypoint reachable from the root UI', function () {
    const indexHtml = readDistFile(distIndexPath);

    assert.match(indexHtml, /href="\/webdav"/);
    assert.ok(fs.existsSync(webdavPath), 'dist/webdav.html should exist');
    assert.ok(fs.existsSync(legacyWebdavPath), 'dist/legacy/webdav.html should exist');
    assert.match(readDistFile(webdavPath), /WebDAV 上传中心/);
  });

  it('does not emit retired Nuxt or old admin pages', function () {
    const retiredPaths = [
      path.join(repoRoot, 'frontend', 'dist', 'admin-imgtc.html'),
      path.join(repoRoot, 'frontend', 'dist', 'admin-waterfall.html'),
      path.join(repoRoot, 'frontend', 'dist', 'legacy', 'admin-imgtc.html'),
      path.join(repoRoot, 'frontend', 'dist', 'legacy', 'admin-waterfall.html'),
      path.join(repoRoot, 'frontend', 'dist', '_nuxt'),
      path.join(repoRoot, 'frontend', 'dist', 'legacy', '_nuxt'),
    ];

    for (const retiredPath of retiredPaths) {
      assert.strictEqual(fs.existsSync(retiredPath), false, `${retiredPath} should not be emitted`);
    }
  });

  it('uses root API paths from the legacy WebDAV page copy', function () {
    const webdavHtml = readDistFile(legacyWebdavPath);

    assert.match(webdavHtml, /request\("\/api\/status"\)/);
    assert.match(webdavHtml, /request\("\/upload"/);
    assert.match(webdavHtml, /request\("\/api\/upload-from-url"/);
    assert.match(webdavHtml, /window\.location\.href = "\/login\?redirect="/);
    assert.doesNotMatch(webdavHtml, /request\("\.\/api\/status"\)/);
    assert.doesNotMatch(webdavHtml, /request\("\.\/upload"/);
  });

  it('uses absolute app links from legacy pages so nested copies do not resolve under /legacy', function () {
    const pages = [
      readDistFile(sourceIndexPath),
      readDistFile(sourceAdminPath),
      readDistFile(distIndexPath),
      readDistFile(distAdminPath),
      readDistFile(legacyIndexPath),
      readDistFile(legacyAdminPath),
    ];

    for (const html of pages) {
      assert.doesNotMatch(html, /href="\.\/app\//);
    }
    assert.match(readDistFile(sourceAdminPath), /href="\/app\/storage"/);
    assert.match(readDistFile(sourceAdminPath), /href="\/app\/status"/);
    assert.match(readDistFile(legacyAdminPath), /href="\/app\/storage"/);
    assert.match(readDistFile(legacyAdminPath), /href="\/app\/status"/);
  });

  it('anchors legacy navigation and auth API calls at the site root', function () {
    const appShell = readDistFile(appShellPath);
    const sourceIndex = readDistFile(sourceIndexPath);
    const sourceAdmin = readDistFile(sourceAdminPath);
    const sourceGallery = readDistFile(sourceGalleryPath);
    const sourceWebdav = readDistFile(sourceWebdavPath);
    const legacyIndex = readDistFile(legacyIndexPath);
    const legacyAdmin = readDistFile(legacyAdminPath);
    const legacyWebdav = readDistFile(legacyWebdavPath);

    assert.match(appShell, /<a class="nav-link" href="\/">\{\{ t\('nav\.legacy'\) \}\}<\/a>/);
    assert.doesNotMatch(appShell, /href="\/legacy\/index\.html"/);
    assert.doesNotMatch(appShell, /target="_blank"/);

    for (const html of [sourceIndex, legacyIndex, sourceWebdav, legacyWebdav]) {
      assert.doesNotMatch(html, /href="\.\/(?:gallery|admin|webdav)\.html"/);
      assert.match(html, /href="\/admin"/);
    }

    for (const html of [sourceAdmin, legacyAdmin, sourceGallery]) {
      assert.doesNotMatch(html, /fetch\((['`"])\.\/api/);
      assert.doesNotMatch(html, /\.\/login\.html/);
    }

    assert.match(sourceAdmin, /fetch\('\/api\/auth\/check'/);
    assert.match(sourceGallery, /fetch\('\/api\/auth\/check'/);
    assert.doesNotMatch(sourceGallery, /\.\/api\/manage\/login/);
  });

  it('uses extensionless legacy navigation targets to avoid Cloudflare Pages redirects', function () {
    const sourceIndex = readDistFile(sourceIndexPath);
    const sourceAdmin = readDistFile(sourceAdminPath);
    const sourceGallery = readDistFile(sourceGalleryPath);
    const sourceWebdav = readDistFile(sourceWebdavPath);
    const legacyIndex = readDistFile(legacyIndexPath);
    const legacyAdmin = readDistFile(legacyAdminPath);
    const legacyWebdav = readDistFile(legacyWebdavPath);

    for (const html of [sourceIndex, sourceAdmin, sourceGallery, sourceWebdav, legacyIndex, legacyAdmin, legacyWebdav]) {
      assert.doesNotMatch(html, extensionfulLegacyNavigation);
    }

    assert.match(sourceIndex, /href="\/gallery"/);
    assert.match(sourceIndex, /href="\/webdav"/);
    assert.match(sourceIndex, /href="\/admin"/);
    assert.match(sourceWebdav, /href="\/gallery"/);
    assert.match(sourceWebdav, /href="\/admin"/);
    assert.match(sourceAdmin, /url: '\/gallery'/);
  });

  it('does not animate full legacy document containers on initial page load', function () {
    const sourceIndex = readDistFile(sourceIndexPath);
    const sourceGallery = readDistFile(sourceGalleryPath);
    const legacyLogin = readDistFile(path.join(repoRoot, 'login.html'));

    assert.doesNotMatch(sourceIndex, /#app\s*\{[\s\S]*?animation:\s*fadeIn\b/);
    assert.doesNotMatch(sourceGallery, /#app\s*\{[\s\S]*?animation:\s*fadeIn\b/);
    assert.doesNotMatch(legacyLogin, /\.login-container\s*\{[\s\S]*?animation:\s*fadeInUp\b/);
  });
});
