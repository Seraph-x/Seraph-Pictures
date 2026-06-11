import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(process.cwd(), '..');
const distDir = path.resolve(process.cwd(), 'dist');
const appDistDir = path.resolve(distDir, 'app');

const legacyFiles = [
  'index.html',
  'login.html',
  'admin.html',
  'admin-imgtc.html',
  'admin-waterfall.html',
  'gallery.html',
  'preview.html',
  'webdav.html',
  'block-img.html',
  'whitelist-on.html',
  'theme.css',
  'claude-theme.css',
  'claude-layout.css',
  'claude-admin-layout.css',
  'seraph-ui-polish.css',
  'seraph-admin-polish.css',
  'theme.js',
  'mobile-refactor.css',
  'admin-imgtc.css',
  'favicon.ico',
  'favicon.svg',
  'logo.png',
  'bg.svg',
  'music.svg',
];

const legacyDirs = ['_nuxt'];
const SPA_REWRITE_STATUS = 200;
const appDeepLinkRoutes = ['login', 'drive', 'admin', 'storage', 'status'];

function ensureDir(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function copyEntry(relativePath, targetBase = '') {
  const from = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(from)) return;
  const to = path.resolve(distDir, targetBase, relativePath);
  ensureDir(to);

  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.cpSync(from, to, { recursive: true, force: true });
    return;
  }
  fs.copyFileSync(from, to);
}

function preserveViteApp() {
  const viteIndex = path.resolve(distDir, 'index.html');
  const viteAssets = path.resolve(distDir, 'assets');
  if (!fs.existsSync(viteIndex)) {
    throw new Error('Vite build output is missing dist/index.html.');
  }

  fs.mkdirSync(appDistDir, { recursive: true });
  fs.copyFileSync(viteIndex, path.resolve(appDistDir, 'index.html'));

  if (fs.existsSync(viteAssets)) {
    fs.cpSync(viteAssets, path.resolve(appDistDir, 'assets'), { recursive: true, force: true });
  }
}

function writeAppDeepLinkEntrypoints() {
  const appIndex = path.resolve(appDistDir, 'index.html');
  const appIndexHtml = fs.readFileSync(appIndex);

  for (const route of appDeepLinkRoutes) {
    const directoryEntry = path.resolve(appDistDir, route, 'index.html');
    const htmlEntry = path.resolve(appDistDir, `${route}.html`);
    ensureDir(directoryEntry);
    ensureDir(htmlEntry);
    fs.writeFileSync(directoryEntry, appIndexHtml);
    fs.writeFileSync(htmlEntry, appIndexHtml);
  }
}

function writeRedirects() {
  const redirects = [
    `/app /app/index.html ${SPA_REWRITE_STATUS}`,
    `/app/* /app/index.html ${SPA_REWRITE_STATUS}`,
    '',
  ];
  fs.writeFileSync(path.resolve(distDir, '_redirects'), redirects.join('\n'), 'utf8');
}

fs.mkdirSync(distDir, { recursive: true });
preserveViteApp();
writeAppDeepLinkEntrypoints();

// Keep legacy pages at root as the default UI, while preserving the Vite app under /app/.
for (const file of legacyFiles) {
  copyEntry(file);
  copyEntry(file, 'legacy');
}
for (const dir of legacyDirs) {
  copyEntry(dir);
  copyEntry(dir, 'legacy');
}

writeRedirects();

console.log('[frontend] legacy root + optional /app Vue assets copied to dist');
