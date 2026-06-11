const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

const HEX_IPV4_PATTERN = /^0x[0-9a-f]+$/i;
const DECIMAL_IPV4_PATTERN = /^\d+$/;

export class RemoteUrlError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RemoteUrlError';
    this.status = status;
  }
}

export function parseSafeRemoteUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl || '').trim());
  } catch {
    throw new RemoteUrlError('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new RemoteUrlError('Only HTTP/HTTPS URLs are supported');
  }

  assertPublicHostname(parsedUrl.hostname);
  parsedUrl.username = '';
  parsedUrl.password = '';
  return parsedUrl;
}

export function assertPublicRedirect(response, baseUrl = '') {
  const location = response.headers.get('location');
  if (!location) return null;
  const nextUrl = new URL(location, baseUrl || response.url);
  return parseSafeRemoteUrl(nextUrl.toString());
}

export function assertAllowedRemoteHost(parsedUrl, rawAllowlist) {
  const allowedHosts = parseAllowedHosts(rawAllowlist);
  if (!allowedHosts.length) {
    throw new RemoteUrlError('URL upload allowed hosts are not configured');
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  const allowed = allowedHosts.some((entry) => matchesAllowedHost(hostname, entry));
  if (!allowed) {
    throw new RemoteUrlError('Remote URL host is not allowed');
  }
}

export function assertPublicHostname(rawHostname) {
  const hostname = normalizeHostname(rawHostname);
  if (!hostname) throw new RemoteUrlError('URL hostname is required');
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw new RemoteUrlError('Private or internal URL hosts are blocked');
  }
  if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) {
    throw new RemoteUrlError('Private or internal URL hosts are blocked');
  }
}

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function isBlockedIpv4(hostname) {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseIpv4(hostname) {
  const decimal = parseNonDottedIpv4(hostname);
  if (decimal) return decimal;
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number.parseInt(part, 10));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return bytes;
}

function parseNonDottedIpv4(hostname) {
  if (!HEX_IPV4_PATTERN.test(hostname) && !DECIMAL_IPV4_PATTERN.test(hostname)) {
    return null;
  }
  const value = Number.parseInt(hostname, hostname.startsWith('0x') ? 16 : 10);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ];
}

function isBlockedIpv6(hostname) {
  if (!hostname.includes(':')) return false;
  if (hostname.startsWith('::ffff:')) {
    return true;
  }
  return (
    hostname === '::' ||
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe8') ||
    hostname.startsWith('fe9') ||
    hostname.startsWith('fea') ||
    hostname.startsWith('feb')
  );
}

function parseAllowedHosts(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeHostname(entry))
    .filter(Boolean);
}

function matchesAllowedHost(hostname, entry) {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(1);
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === entry;
}
