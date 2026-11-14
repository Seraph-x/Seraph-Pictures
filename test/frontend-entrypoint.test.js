const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const distIndexPath = path.join(repoRoot, 'frontend', 'dist', 'index.html');
const distAdminPath = path.join(repoRoot, 'frontend', 'dist', 'admin.html');
const webdavPath = path.join(repoRoot, 'frontend', 'dist', 'webdav.html');
const legacyIndexPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'index.html');
const legacyAdminPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'admin.html');
const legacyWebdavPath = path.join(repoRoot, 'frontend', 'dist', 'legacy', 'webdav.html');
const sourceIndexPath = path.join(repoRoot, 'index.html');
const sourceAdminPath = path.join(repoRoot, 'admin.html');
const sourceGalleryPath = path.join(repoRoot, 'gallery.html');
const sourceWebdavPath = path.join(repoRoot, 'webdav.html');
const extensionfulLegacyNavigation = /(?:href=|url: |window\.location\.(?:href|replace)\s*=\s*)['"]\/(?:gallery|admin|webdav|login|storage-settings)\.html\b/;

function readDistFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readLegacyBundle(filePath, assetRoot) {
  const shell = readDistFile(filePath);
  const refs = [...shell.matchAll(/(?:src|href)="(\/legacy\/[^"?]+\.(?:js|css))/g)]
    .map((match) => path.join(assetRoot, match[1].slice(1)));
  return [shell, ...refs.map(readDistFile)].join('\n');
}

function sourceBundle(filePath) {
  return readLegacyBundle(filePath, repoRoot);
}

function distBundle(filePath) {
  return readLegacyBundle(filePath, path.join(repoRoot, 'frontend', 'dist'));
}

describe('frontend Pages entrypoint', function () {
  it('serves the legacy upload page at the site root', function () {
    const indexHtml = distBundle(distIndexPath);

    assert.match(indexHtml, /<title>Seraph's Pictures<\/title>/);
    assert.match(indexHtml, /class="upload-zone"/);
    assert.doesNotMatch(indexHtml, /<title>Seraph's Pictures App<\/title>/);
    assert.doesNotMatch(indexHtml, /Upload files, manage folders/);
    assert.doesNotMatch(indexHtml, /Start Uploading/);
  });

  it('publishes a real 404 document without SPA rewrites or app entries', function () {
    const dist = path.join(repoRoot, 'frontend', 'dist');
    assert.match(readDistFile(path.join(dist, '404.html')), /页面不存在/);
    assert.strictEqual(fs.existsSync(path.join(dist, '_redirects')), false);
    assert.strictEqual(fs.existsSync(path.join(dist, 'app')), false);
  });

  it('keeps the legacy WebDAV entrypoint reachable from the root UI', function () {
    const indexHtml = distBundle(distIndexPath);

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
    const webdavBundle = distBundle(legacyWebdavPath);

    assert.match(webdavHtml, /\/legacy\/storage\/api\.js/);
    assert.match(webdavHtml, /\/legacy\/pages\/webdav\/profile-controller\.js/);
    assert.match(webdavHtml, /\/legacy\/pages\/webdav\/upload-actions\.js/);
    assert.doesNotMatch(webdavHtml, /request\("\/api\/status"\)/);
    assert.match(webdavBundle, /request\('\/upload'/);
    assert.match(webdavBundle, /request\('\/api\/upload-from-url'/);
    assert.match(webdavHtml, /window\.location\.href = "\/login\?redirect="/);
    assert.doesNotMatch(webdavHtml, /request\("\.\/api\/status"\)/);
    assert.doesNotMatch(webdavHtml, /request\("\.\/upload"/);
  });

  it('keeps retired app navigation out of Legacy pages', function () {
    const pages = [
      sourceBundle(sourceIndexPath),
      sourceBundle(sourceAdminPath),
      distBundle(distIndexPath),
      distBundle(distAdminPath),
      distBundle(legacyIndexPath),
      distBundle(legacyAdminPath),
    ];

    for (const html of pages) {
      assert.doesNotMatch(html, /href="\.\/app\//);
    }
    assert.doesNotMatch(sourceBundle(sourceAdminPath), /href="\/app\/(?:storage|status)"/);
    assert.doesNotMatch(distBundle(legacyAdminPath), /href="\/app\/(?:storage|status)"/);
  });

  it('anchors legacy navigation and auth API calls at the site root', function () {
    const sourceIndex = sourceBundle(sourceIndexPath);
    const sourceAdmin = sourceBundle(sourceAdminPath);
    const sourceGallery = readDistFile(sourceGalleryPath);
    const sourceWebdav = readDistFile(sourceWebdavPath);
    const legacyIndex = distBundle(legacyIndexPath);
    const legacyAdmin = distBundle(legacyAdminPath);
    const legacyWebdav = readDistFile(legacyWebdavPath);

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
    const sourceIndex = sourceBundle(sourceIndexPath);
    const sourceAdmin = sourceBundle(sourceAdminPath);
    const sourceGallery = readDistFile(sourceGalleryPath);
    const sourceWebdav = readDistFile(sourceWebdavPath);
    const legacyIndex = distBundle(legacyIndexPath);
    const legacyAdmin = distBundle(legacyAdminPath);
    const legacyWebdav = readDistFile(legacyWebdavPath);

    for (const html of [sourceIndex, sourceAdmin, sourceGallery, sourceWebdav, legacyIndex, legacyAdmin, legacyWebdav]) {
      assert.doesNotMatch(html, extensionfulLegacyNavigation);
    }

    assert.match(sourceIndex, /href="\/gallery"/);
    assert.match(sourceIndex, /href="\/webdav"/);
    assert.match(sourceIndex, /href="\/admin"/);
    assert.match(sourceWebdav, /href="\/gallery"/);
    assert.match(sourceWebdav, /href="\/admin"/);
    assert.doesNotMatch(sourceAdmin, /url: '\/gallery'/);
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
