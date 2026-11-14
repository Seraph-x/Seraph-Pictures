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
// Source layout is independent of public URLs, including the /legacy aliases.
const PUBLIC_DIRECTORIES = Object.freeze([
  ['scripts/pages', 'legacy/pages'],
  ['scripts/storage', 'legacy/storage'],
  ['styles/pages/admin', 'legacy/pages/admin/styles'],
  ['styles/pages/upload', 'legacy/pages/upload/styles'],
  ['styles/pages/webdav', 'legacy/pages/webdav'],
  ['assets/fonts', 'assets'],
]);

function sourceFile(file) {
  const directory = { '.html': 'pages', '.css': 'styles', '.js': 'scripts' }[path.extname(file)] || 'assets';
  return path.join(directory, file);
}

function copyFile(source, output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output);
}

export function buildStatic(options = {}) {
  const rootDir = path.resolve(options.rootDir || PROJECT_ROOT);
  const sourceDir = path.join(rootDir, 'frontend');
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'frontend/dist'));
  if (rootDir === outputDir || rootDir.startsWith(`${outputDir}${path.sep}`)) {
    throw new Error('Build output must not contain the source directory.');
  }
  for (const directory of ['pages', 'scripts', 'styles', 'assets']) {
    const inputDir = path.join(sourceDir, directory);
    if (inputDir === outputDir || inputDir.startsWith(`${outputDir}${path.sep}`) || outputDir.startsWith(`${inputDir}${path.sep}`)) {
      throw new Error('Build output must not overlap a frontend source directory.');
    }
  }
  // Validate the complete input before removing a previous build.
  const extraFiles = [
    ['pages/404.html', '404.html'],
    ['styles/pages/storage-settings.css', 'legacy/pages/storage-settings.css'],
  ];
  const inputs = [...PUBLIC_FILES.map(sourceFile), ...extraFiles.map(([source]) => source), ...PUBLIC_DIRECTORIES.map(([source]) => source)];
  for (const entry of inputs) {
    fs.accessSync(path.join(sourceDir, entry), fs.constants.R_OK);
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDir, 'legacy'), { recursive: true });
  for (const file of PUBLIC_FILES) {
    copyFile(path.join(sourceDir, sourceFile(file)), path.join(outputDir, file));
    copyFile(path.join(sourceDir, sourceFile(file)), path.join(outputDir, 'legacy', file));
  }
  for (const [source, destination] of PUBLIC_DIRECTORIES) {
    fs.cpSync(path.join(sourceDir, source), path.join(outputDir, destination), { recursive: true });
  }
  for (const [source, destination] of extraFiles) {
    copyFile(path.join(sourceDir, source), path.join(outputDir, destination));
  }
  // GET /upload remains a page alias; POST /upload is handled by Pages Functions.
  copyFile(path.join(sourceDir, 'pages/index.html'), path.join(outputDir, 'upload.html'));
  return outputDir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`[static] Legacy site built at ${buildStatic()}`);
}
