const { requireStorageAuth } = require('./common');

function readiness(config) {
  const bootstrap = config?.bootstrapDefaultStorage || {};
  const byType = Object.fromEntries([
    ['telegram', Boolean(bootstrap.telegram?.botToken && bootstrap.telegram?.chatId)],
    ['r2', Boolean(bootstrap.r2?.endpoint && bootstrap.r2?.bucket
      && bootstrap.r2?.accessKeyId && bootstrap.r2?.secretAccessKey)],
    ['s3', Boolean(bootstrap.s3?.endpoint && bootstrap.s3?.bucket
      && bootstrap.s3?.accessKeyId && bootstrap.s3?.secretAccessKey)],
    ['discord', Boolean(bootstrap.discord?.webhookUrl
      || (bootstrap.discord?.botToken && bootstrap.discord?.channelId))],
    ['huggingface', Boolean(bootstrap.huggingface?.token && bootstrap.huggingface?.repo)],
    ['webdav', Boolean(bootstrap.webdav?.baseUrl && (bootstrap.webdav?.bearerToken
      || (bootstrap.webdav?.username && bootstrap.webdav?.password)))],
    ['github', Boolean(bootstrap.github?.repo && bootstrap.github?.token)],
  ]);
  return Object.freeze({ defaultType: String(bootstrap.type || 'telegram').toLowerCase(), byType });
}

function registerStorageBootstrapRoute(app, container, helpers) {
  app.post('/api/storage/bootstrap/sync', (context) => {
    const unauthorized = requireStorageAuth(context, helpers);
    if (unauthorized) return unauthorized;
    const repo = helpers.getServices(context).storageRepo;
    repo.ensureBootstrapStorage();
    return context.json({
      success: true, synced: true, bootstrap: readiness(container.config), items: repo.list(false),
    });
  });
}

module.exports = { registerStorageBootstrapRoute };
