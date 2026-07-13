const { timingSafeStringEqual } = require('../lib/utils/auth');
const { getClientIp } = require('../lib/utils/client-ip');

function registerAuthRoutes(app, container, helpers) {
  const { getServices, jsonError, firstNonEmpty, authResult } = helpers;

  app.get('/api/auth/check', (c) => {
    const { authService, guestService } = getServices(c);
    const auth = authService.checkAuthentication(c.req.raw);

    return c.json({
      authenticated: auth.authenticated,
      authRequired: authService.isAuthRequired(),
      reason: auth.reason,
      guestUpload: guestService.getConfig(),
    });
  });

  app.post('/api/auth/login', async (c) => {
    const { authService, loginRateLimitService } = getServices(c);

    if (!authService.isAuthRequired()) {
      return c.json({ success: true, authRequired: false, message: 'No login required.' });
    }

    const clientIp = getClientIp(c.req.raw);
    const limit = loginRateLimitService.check(clientIp);
    if (limit.blocked) {
      c.header('Retry-After', String(limit.retryAfter));
      return jsonError(
        c,
        429,
        'LOGIN_RATE_LIMITED',
        'Too many failed login attempts.',
        'Wait before trying again.'
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const username = firstNonEmpty(body.username, body.user);
    const password = String(body.password ?? body.pass ?? '');

    if (!username || password === '') {
      return jsonError(
        c,
        400,
        'MISSING_CREDENTIALS',
        'Missing username or password.',
        'Provide both username and password.'
      );
    }

    if (!timingSafeStringEqual(username, container.config.basicUser)
      || !timingSafeStringEqual(password, container.config.basicPass)) {
      loginRateLimitService.recordFailure(clientIp);
      return jsonError(
        c,
        401,
        'INVALID_CREDENTIALS',
        'Invalid username or password.',
        'Credential verification failed.'
      );
    }

    const session = authService.createSession(username);
    loginRateLimitService.clear(clientIp);
    c.header('Set-Cookie', authService.createSessionCookie(session.token));

    return c.json({ success: true, message: 'Login successful.' });
  });

  app.post('/api/auth/logout', (c) => {
    const { authService } = getServices(c);
    const token = authService.getSessionTokenFromRequest(c.req.raw);
    authService.deleteSession(token);

    const clearCookies = authService.createClearSessionCookies();
    const response = c.json({ success: true, message: 'Logged out.' });
    response.headers.append('Set-Cookie', clearCookies[0]);
    response.headers.append('Set-Cookie', clearCookies[1]);
    return response;
  });

  app.get('/api/auth/login', (c) => {
    const { authService } = getServices(c);
    return c.json({
      authRequired: authService.isAuthRequired(),
    });
  });

  // Compatibility aliases
  app.get('/api/manage/check', (c) => {
    const { authService } = getServices(c);
    return c.text(authService.isAuthRequired() ? 'true' : 'Not using basic auth.');
  });

  app.get('/api/manage/login', (c) => {
    const auth = authResult(c);
    if (auth.authenticated) {
      return c.redirect('/admin.html', 302);
    }
    return c.redirect('/login.html?redirect=%2Fadmin.html', 302);
  });

  const handleManageLogout = (c) => {
    const { authService } = getServices(c);
    const token = authService.getSessionTokenFromRequest(c.req.raw);
    authService.deleteSession(token);
    const clearCookies = authService.createClearSessionCookies();
    const response = c.redirect('/login.html', 302);
    response.headers.append('Set-Cookie', clearCookies[0]);
    response.headers.append('Set-Cookie', clearCookies[1]);
    return response;
  };
  app.get('/api/manage/logout', handleManageLogout);
  app.post('/api/manage/logout', handleManageLogout);
}

module.exports = {
  registerAuthRoutes,
};
