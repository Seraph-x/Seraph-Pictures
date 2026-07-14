import fs from 'node:fs';
import path from 'node:path';
import { syncDirectory } from './sync-directory.mjs';

const rootDir = path.resolve(process.cwd(), '..');
const distDir = path.resolve(process.cwd(), 'dist');
const appDistDir = path.resolve(distDir, 'app');

const legacyFiles = [
  'index.html',
  'login.html',
  'admin.html',
  'gallery.html',
  'preview.html',
  'webdav.html',
  'storage-settings.html',
  'block-img.html',
  'whitelist-on.html',
  'theme.css',
  'claude-theme.css',
  'claude-layout.css',
  'claude-admin-layout.css',
  'seraph-ui-polish.css',
  'seraph-admin-polish.css',
  'theme.js',
  'i18n.js',
  'mobile-refactor.css',
  'admin-imgtc.css',
  'favicon.ico',
  'favicon.svg',
  'logo.png',
  'bg.svg',
  'music.svg',
];

const legacyDirs = ['legacy'];
const SPA_REWRITE_STATUS = 200;
const appDeepLinkRoutes = ['login', 'drive', 'admin', 'storage', 'status'];

function ensureDir(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function copyEntry(relativePath, targetBase = '') {
  const from = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(from)) {
    throw new Error(`Legacy asset is missing: ${relativePath}`);
  }
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
    const htmlEntry = path.resolve(appDistDir, route + '.html');
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

function copyMiddleware() {
  const functionsDir = path.resolve(distDir, 'functions');
  fs.mkdirSync(functionsDir, { recursive: true });

  const middlewareContent = `export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith('/app/') && !url.pathname.match(/\\.(js|css|png|jpg|svg|ico|json)$/)) {
    url.pathname = '/app/index.html';
    return context.env.ASSETS.fetch(new Request(url, context.request));
  }
  return context.next();
}
`;
  fs.writeFileSync(path.resolve(functionsDir, '_middleware.js'), middlewareContent, 'utf8');
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
}

writeRedirects();
copyMiddleware();

// Copy dist/app to project root for Wrangler dev server
const projectRoot = path.resolve(rootDir);
const distAppDir = path.resolve(distDir, 'app');
const rootAppDir = path.resolve(projectRoot, 'app');

if (fs.existsSync(distAppDir)) {
  syncDirectory(distAppDir, rootAppDir);
  console.log('[frontend] app/ directory synced to project root');
}

console.log('[frontend] legacy root + optional /app Vue assets copied to dist');
