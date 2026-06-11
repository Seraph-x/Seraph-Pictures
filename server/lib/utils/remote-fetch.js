const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns/promises');
const { assertPublicHostname } = require('./remote-url');

async function defaultResolveHostname(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => ({
    address: record.address,
    family: record.family,
  }));
}

function defaultRequestRemote(parsedUrl, options = {}) {
  const client = parsedUrl.protocol === 'https:' ? https : http;
  const requestOptions = buildRequestOptions(parsedUrl, options);
  return new Promise((resolve, reject) => {
    const request = client.request(requestOptions, (response) => {
      resolve(new Response(response, {
        status: response.statusCode || 502,
        headers: response.headers,
      }));
    });
    request.on('error', reject);
    wireAbortSignal(request, options.signal, reject);
    request.end();
  });
}

function buildRequestOptions(parsedUrl, options = {}) {
  return {
    method: 'GET',
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || undefined,
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers: options.headers || {},
    lookup: checkedLookup,
  };
}

function checkedLookup(hostname, options, callback) {
  dns.lookup(hostname, options)
    .then((record) => resolveCheckedLookup(record, callback))
    .catch(callback);
}

function resolveCheckedLookup(record, callback) {
  const records = Array.isArray(record) ? record : [record];
  for (const item of records) assertPublicHostname(item.address || item);
  if (Array.isArray(record)) return callback(null, record);
  return callback(null, record.address, record.family);
}

function wireAbortSignal(request, signal, reject) {
  if (!signal) return;
  if (signal.aborted) {
    abortRequest(request, reject);
    return;
  }
  signal.addEventListener('abort', () => abortRequest(request, reject), { once: true });
}

function abortRequest(request, reject) {
  const error = new Error('Remote URL request timed out.');
  error.name = 'AbortError';
  request.destroy(error);
  reject(error);
}

module.exports = {
  defaultRequestRemote,
  defaultResolveHostname,
};
