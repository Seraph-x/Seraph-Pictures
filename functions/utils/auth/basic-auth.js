function parseBasicCredentials(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const [scheme, encoded] = authorization.split(' ');
  if (scheme !== 'Basic' || !encoded) return null;
  try {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes).normalize();
    const separator = decoded.indexOf(':');
    if (separator < 0 || /[\0-\x1F\x7F]/.test(decoded)) return null;
    return Object.freeze({
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    });
  } catch {
    return null;
  }
}

export async function verifyBasicAuth(request, verify) {
  const credentials = parseBasicCredentials(request);
  if (!credentials) return null;
  const result = await verify(credentials.username, credentials.password);
  if (!result.ok) return null;
  return Object.freeze({ user: credentials.username, authenticated: true });
}
