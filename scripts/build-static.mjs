import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_FILES = Object.freeze([
  'index.html', 'login.html', 'admin.html', 'gallery.html', 'preview.html',
  'webdav.html', 'storage-settings.html', 'block-img.html', 'whitelist-on.html',
  'theme.css', 'claude-theme.css', 'claude-layout.css', 'claude-admin-layout.css',
  'seraph-ui-polish.css', 'seraph-admin-polish.css', 'theme.js', 'i18n.js',
  'mobile-refactor.css', 'admin-imgtc.css', 'favicon.ico', 'favicon.svg',
  'logo.png', 'bg.svg', 'music.svg',
]);
const PUBLIC_DIRECTORIES = Object.freeze(['legacy', 'assets']);

export function buildStatic(options = {}) {
  const rootDir = path.resolve(options.rootDir || PROJECT_ROOT);
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'frontend/dist'));
  if (rootDir === outputDir || rootDir.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error('Build output must not contain the source directory.');
  }
  // Validate the complete input before removing a previous build.
  for (const entry of [...PUBLIC_FILES, '404.html', ...PUBLIC_DIRECTORIES]) {
    fs.accessSync(path.join(rootDir, entry), fs.constants.R_OK);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDir, 'legacy'), { recursive: true });
  for (const file of PUBLIC_FILES) {
    fs.copyFileSync(path.join(rootDir, file), path.join(outputDir, file));
    fs.copyFileSync(path.join(rootDir, file), path.join(outputDir, 'legacy', file));
  }
  for (const directory of PUBLIC_DIRECTORIES) {
    fs.cpSync(path.join(rootDir, directory), path.join(outputDir, directory), { recursive: true });
  }
  // GET /upload remains a page alias; POST /upload is handled by Pages Functions.
  fs.copyFileSync(path.join(rootDir, 'index.html'), path.join(outputDir, 'upload.html'));
  // A top-level 404 disables Cloudflare Pages' implicit SPA fallback.
  fs.copyFileSync(path.join(rootDir, '404.html'), path.join(outputDir, '404.html'));
  return outputDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`[static] Legacy site built at ${buildStatic()}`);
}
