const { handleTelegramWebhook } = require('./telegram-webhook');

async function bingWallpaper(context, helpers) {
  const response = await fetch('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=5');
  if (!response.ok) {
    return helpers.jsonError(
      context,
      502,
      'UPSTREAM_BING_FAILED',
      'Failed to fetch Bing wallpapers.',
      `Bing upstream returned HTTP ${response.status}.`,
      true,
    );
  }
  const payload = await response.json();
  return context.json({ status: true, message: 'ok', data: payload.images || [] });
}

function registerTelegramRoutes(app, container, helpers) {
  const wallpaper = (context) => bingWallpaper(context, helpers);
  app.get('/api/bing/wallpaper', wallpaper);
  app.get('/api/bing/wallpaper/', wallpaper);
  app.post('/api/telegram/webhook', (context) => (
    handleTelegramWebhook(context, container, helpers)
  ));
  app.get('/api/health', (context) => context.json({
    ok: true, mode: 'docker-node', timestamp: Date.now(),
  }));
}

module.exports = { registerTelegramRoutes };
