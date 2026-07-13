const statusPolicy = require('../../shared/security/status-policy.cjs');
const { collectDockerStatus } = require('../lib/services/status-service');

const { STATUS_ACTORS, decideStatusAccess } = statusPolicy;

function actorFor(options) {
  if (!options.authService.isAuthRequired()) {
    return options.nodeEnv === 'production' ? STATUS_ACTORS.ANONYMOUS : STATUS_ACTORS.ADMIN;
  }
  return options.authService.checkAuthentication(options.request).authenticated
    ? STATUS_ACTORS.ADMIN
    : STATUS_ACTORS.ANONYMOUS;
}

function registerStatusRoutes(app, container, helpers) {
  app.get('/api/status', async (context) => {
    const services = helpers.getServices(context);
    context.header('Cache-Control', 'no-cache');
    const decision = decideStatusAccess({
      actor: actorFor({
        request: context.req.raw,
        authService: services.authService,
        nodeEnv: container.config.nodeEnv,
      }),
    });
    if (!decision.runProbes) return context.json(decision.body);
    const status = await collectDockerStatus({
      services,
      config: container.config,
      formatDetail: helpers.formatStatusDetail,
      uploadLimits: helpers.getUploadLimits(),
    });
    return context.json(status);
  });
}

module.exports = { registerStatusRoutes };
