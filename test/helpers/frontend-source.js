const path = require('node:path');

const FRONTEND = path.resolve(__dirname, '../../frontend');

// Resolve published /legacy asset references against source, without relying on dist.
function legacyAssetSource(publicPath) {
  if (!publicPath.startsWith('/legacy/')) throw new Error(`Unexpected asset URL: ${publicPath}`);
  const relative = publicPath.slice('/legacy/'.length);
  if (relative.endsWith('.js')) return path.join(FRONTEND, 'scripts', relative);
  if (relative.endsWith('.css')) return path.join(FRONTEND, 'styles', relative.replace('/styles/', '/'));
  throw new Error(`Unsupported asset URL: ${publicPath}`);
}

module.exports = { legacyAssetSource };
