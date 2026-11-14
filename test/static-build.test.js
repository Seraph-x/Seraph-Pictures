const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

describe('Legacy-only static distribution', function () {
  let directory;
  beforeEach(function () { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'seraph-static-')); });
  afterEach(function () { fs.rmSync(directory, { recursive: true, force: true }); });

  it('builds Legacy pages and their public assets without stale SPA output or private files', async function () {
    const { buildStatic } = await import('../scripts/build-static.mjs');
    fs.mkdirSync(path.join(directory, 'app/assets'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'app/assets/old.js'), 'obsolete');
    fs.writeFileSync(path.join(directory, '_redirects'), '/app/* /app/index.html 200');
    buildStatic({ outputDir: directory });
    for (const file of ['index.html', 'admin.html', 'login.html', 'gallery.html', 'webdav.html', 'storage-settings.html', 'preview.html', '404.html']) {
      assert.deepEqual(fs.readFileSync(path.join(directory, file)), fs.readFileSync(path.join(ROOT, 'frontend/pages', file)));
    }
    assert.deepEqual(fs.readFileSync(path.join(directory, 'legacy/index.html')), fs.readFileSync(path.join(ROOT, 'frontend/pages/index.html')));
    assert.deepEqual(fs.readFileSync(path.join(directory, 'upload.html')), fs.readFileSync(path.join(ROOT, 'frontend/pages/index.html')));
    assert.ok(fs.existsSync(path.join(directory, 'legacy/pages/upload/components/page-header.js')));
    for (const moduleName of ['api', 'selection', 'messages', 'settings-renderer', 'settings-controller']) {
      const file = `legacy/storage/${moduleName}.js`;
      assert.deepEqual(fs.readFileSync(path.join(directory, file)), fs.readFileSync(path.join(ROOT, 'frontend/scripts/storage', `${moduleName}.js`)));
    }
    assert.ok(fs.readdirSync(path.join(directory, 'assets')).some((file) => file.endsWith('.woff2')));
    for (const file of ['app', '_redirects', 'functions', '.env', '.dev.vars', 'frontend', 'node_modules', 'package.json', 'docs', 'test']) {
      assert.equal(fs.existsSync(path.join(directory, file)), false, `Unexpected public output: ${file}`);
    }
  });

  it('reports missing source assets before replacing an existing distribution', async function () {
    const { buildStatic } = await import('../scripts/build-static.mjs');
    const output = path.join(directory, 'dist');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'previous.html'), 'previous');
    assert.throws(() => buildStatic({ rootDir: directory, outputDir: output }), /index\.html/);
    assert.equal(fs.readFileSync(path.join(output, 'previous.html'), 'utf8'), 'previous');
  });

  it('rejects output paths that could overwrite or include frontend source', async function () {
    const { buildStatic } = await import('../scripts/build-static.mjs');
    const source = path.join(directory, 'frontend/pages/index.html');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'source must survive');
    for (const output of ['frontend', 'frontend/pages', 'frontend/pages/dist']) {
      assert.throws(() => buildStatic({ rootDir: directory, outputDir: path.join(directory, output) }), /overlap/);
      assert.equal(fs.readFileSync(source, 'utf8'), 'source must survive');
    }
  });

  it('removes the Vue 3 source, install commands, and SPA routing', function () {
    const pkg = require('../package.json');
    assert.equal(pkg.scripts.build, 'node scripts/build-static.mjs');
    assert.equal(pkg.scripts['pages:deploy'], 'npm run build && npx wrangler pages deploy frontend/dist');
    assert.equal(Object.keys(pkg.scripts).some((key) => key.includes('frontend')), false);
    for (const target of ['app', 'frontend/src', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.js', 'frontend/index.html', 'frontend/landing']) {
      assert.equal(fs.existsSync(path.join(ROOT, target)), false, `${target} must be retired`);
    }
    const nginx = fs.readFileSync(path.join(ROOT, 'frontend/nginx.conf'), 'utf8');
    assert.doesNotMatch(nginx, /\/app\/index\.html/);
    assert.match(nginx, /try_files \$uri \$uri\.html \$uri\/ =404;/);
    assert.match(nginx, /location \/api\//);
    assert.match(fs.readFileSync(path.join(ROOT, 'frontend/pages/index.html'), 'utf8'), /vue@2/);
  });
});
