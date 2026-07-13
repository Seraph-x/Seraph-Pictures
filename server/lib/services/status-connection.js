const WEBDAV_SUCCESS = 207;

function webDavModes(config) {
  const modes = [];
  if (config.bearerToken) modes.push('bearer');
  if (config.username && config.password) modes.push('basic');
  modes.push('none');
  return [...new Set(modes)];
}

async function githubConnection(adapter, signal) {
  adapter.validate();
  const response = await fetch(adapter.repoApi(''), {
    headers: adapter.authHeaders(),
    signal,
  });
  const detail = response.ok ? '' : await response.text().catch(() => '');
  return {
    connected: response.ok,
    status: response.status,
    detail: detail || (response.ok ? '' : 'GitHub repository access failed.'),
    mode: adapter.config.mode,
  };
}

async function webDavAttempt(options) {
  const headers = options.adapter.getAuthHeadersForMode(options.mode, { Depth: '0' });
  const response = await fetch(options.adapter.config.baseUrl, {
    method: 'OPTIONS', headers, signal: options.signal,
  });
  if (response.ok) return { connected: true, status: response.status, method: 'OPTIONS' };
  const propfind = await fetch(options.adapter.config.baseUrl, {
    method: 'PROPFIND',
    headers: options.adapter.getAuthHeadersForMode(options.mode, {
      Depth: '0', 'Content-Type': 'application/xml; charset=utf-8',
    }),
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"/>',
    signal: options.signal,
  });
  return {
    connected: propfind.ok || propfind.status === WEBDAV_SUCCESS,
    status: propfind.status,
    method: 'PROPFIND',
  };
}

async function webDavConnection(adapter, signal) {
  adapter.validate();
  let result = { connected: false, detail: 'WebDAV connection failed.' };
  for (const mode of webDavModes(adapter.config)) {
    result = await webDavAttempt({ adapter, mode, signal });
    if (result.connected) return result;
  }
  return result;
}

async function testStatusConnection(options) {
  if (options.type === 'github') return githubConnection(options.adapter, options.signal);
  if (options.type === 'webdav') return webDavConnection(options.adapter, options.signal);
  return options.adapter.testConnection({ signal: options.signal });
}

module.exports = { testStatusConnection };
