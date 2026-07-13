const SESSION_COOKIE_NAME = 'seraph_pictures_session';
const LEGACY_COOKIE_NAMES = Object.freeze(['k_vault_session', 'katelya_session']);
const SESSION_DURATION_SECONDS = 24 * 60 * 60;

export function getSessionFromCookie(request) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1);
    if (name === SESSION_COOKIE_NAME || LEGACY_COOKIE_NAMES.includes(name)) return value;
  }
  return null;
}

export function createSessionCookieHeader(token, options = {}) {
  const maxAge = options.maxAge ?? SESSION_DURATION_SECONDS;
  const secure = options.secure === false ? '' : ' Secure;';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

export function createClearSessionCookieHeader() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function createLegacyClearSessionCookieHeaders() {
  return LEGACY_COOKIE_NAMES.map((name) => (
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  ));
}
