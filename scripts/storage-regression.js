#!/usr/bin/env node

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const BASIC_USER = String(process.env.BASIC_USER || '');
const BASIC_PASS = String(process.env.BASIC_PASS || '');
const SMOKE_STORAGE_TYPE = String(process.env.SMOKE_STORAGE_TYPE || '').trim().toLowerCase();
const SMOKE_STORAGE_CONFIG_JSON = String(process.env.SMOKE_STORAGE_CONFIG_JSON || '').trim();
const state = { cookies: new Map() };

function smokeConfig() {
  if (!SMOKE_STORAGE_TYPE) throw new Error('SMOKE_STORAGE_TYPE is required.');
  if (!SMOKE_STORAGE_CONFIG_JSON) throw new Error('SMOKE_STORAGE_CONFIG_JSON is required.');
  try { return Object.freeze(JSON.parse(SMOKE_STORAGE_CONFIG_JSON)); }
  catch (cause) { throw Object.assign(new Error('SMOKE_STORAGE_CONFIG_JSON_INVALID'), { cause }); }
}

function setCookies(headers) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  for (const value of values) {
    const pair = String(value).split(';')[0];
    const separator = pair.indexOf('=');
    if (separator < 1) throw new Error('COOKIE_RESPONSE_INVALID');
    state.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader() {
  return [...state.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function responsePayload(response) {
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

function responseError(options) {
  const payload = options.payload;
  const detail = typeof payload === 'string'
    ? payload : payload?.error?.code || payload?.errorCode || payload?.error || payload?.message;
  return new Error(`${options.method} ${options.path} failed: ${detail || `HTTP ${options.status}`}`);
}

async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = { ...(options.headers || {}) };
  const cookie = options.cookies === false ? '' : cookieHeader();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: options.body || null, redirect: 'follow',
  });
  if (options.cookies !== false) setCookies(response.headers);
  const payload = await responsePayload(response);
  if (!options.allowError && !response.ok) {
    throw responseError({ method, path, status: response.status, payload });
  }
  return Object.freeze({ response, payload });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login() {
  const auth = await request('/api/auth/check', { cookies: false });
  assert(auth.payload?.authRequired === true, 'Guest isolation requires authentication to be enabled.');
  assert(BASIC_USER && BASIC_PASS, 'BASIC_USER and BASIC_PASS are required.');
  const result = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: BASIC_USER, password: BASIC_PASS }),
  });
  assert(result.payload?.success === true, 'Administrator login failed.');
}

async function listProfiles() {
  const result = await request('/api/storage/list');
  assert(Array.isArray(result.payload?.items), 'Storage list envelope is invalid.');
  return result.payload.items;
}

async function createProfile(name) {
  const result = await request('/api/storage', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, type: SMOKE_STORAGE_TYPE, config: smokeConfig(), enabled: true, isDefault: false,
    }),
  });
  assert(result.payload?.item?.id, `Profile ${name} was not created.`);
  return result.payload.item;
}

async function createSameTypeProfiles() {
  const initial = await listProfiles();
  const originalDefault = initial.find((item) => (
    item.type === SMOKE_STORAGE_TYPE && item.isDefault
  ));
  assert(originalDefault, `Type ${SMOKE_STORAGE_TYPE} needs an existing default profile.`);
  const suffix = `${Date.now()}-${process.pid}`;
  const firstProfile = await createProfile(`regression-first-${suffix}`);
  const secondProfile = await createProfile(`regression-second-${suffix}`);
  return Object.freeze({ firstProfile, secondProfile, originalDefault });
}

async function verifyPerTypeDefault(context) {
  await request(`/api/storage/default/${encodeURIComponent(context.secondProfile.id)}`, {
    method: 'POST',
  });
  const sameType = (await listProfiles()).filter((item) => item.type === SMOKE_STORAGE_TYPE);
  const defaults = sameType.filter((item) => item.isDefault);
  assert(defaults.length === 1, 'Storage type does not have exactly one default.');
  assert(defaults[0].id === context.secondProfile.id, 'Wrong same-type profile became default.');
}

async function uploadExact(profile) {
  const marker = `profile-regression-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = new FormData();
  body.append('file', new File([marker], 'profile-regression.txt', { type: 'text/plain' }));
  body.append('storageMode', profile.type);
  body.append('storageId', profile.id);
  const result = await request('/upload', { method: 'POST', body });
  const src = Array.isArray(result.payload) ? result.payload[0]?.src : result.payload?.src;
  assert(src, 'Exact-profile upload did not return src.');
  return Object.freeze({ marker, src, fileId: decodeURIComponent(src.split('/file/')[1] || '') });
}

async function updateProfile(id, patch) {
  return request(`/api/storage/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
}

function errorCode(payload) {
  return payload?.error?.code || payload?.errorCode || payload?.code || '';
}

async function verifyDisabledHistoricalRead(context, upload) {
  await updateProfile(context.firstProfile.id, { enabled: false });
  const historical = await request(upload.src);
  assert(String(historical.payload).includes(upload.marker), 'Disabled historical read content mismatch.');
  const body = new FormData();
  body.append('file', new File(['blocked'], 'blocked.txt', { type: 'text/plain' }));
  body.append('storageMode', context.firstProfile.type);
  body.append('storageId', context.firstProfile.id);
  const blocked = await request('/upload', { method: 'POST', body, allowError: true });
  assert(errorCode(blocked.payload) === 'STORAGE_NOT_WRITABLE', 'STORAGE_NOT_WRITABLE not returned.');
}

async function verifyGuestIsolation() {
  const list = await request('/api/storage/list', { cookies: false, allowError: true });
  assert([401, 403].includes(list.response.status), 'Guest enumerated storage profiles.');
  const status = await request('/api/status', { cookies: false });
  assert(!Object.hasOwn(status.payload, 'storageProfiles'), 'Guest status exposed storageProfiles.');
}

async function verifyProfileStatus(context) {
  const status = await request('/api/status');
  assert(Array.isArray(status.payload?.storageProfiles), 'Profile-aware status list is missing.');
  const first = status.payload.storageProfiles.find((item) => item.storageId === context.firstProfile.id);
  const second = status.payload.storageProfiles.find((item) => item.storageId === context.secondProfile.id);
  assert(first?.enabled === false, 'Disabled profile status is missing.');
  assert(second?.storageId === context.secondProfile.id, 'Second exact profile status is missing.');
}

async function deleteUpload(upload) {
  const deleted = await request(`/api/manage/delete/${encodeURIComponent(upload.fileId)}`, { method: 'DELETE' });
  assert(deleted.payload?.success === true, 'Uploaded smoke file was not deleted.');
}

async function cleanupProfiles(context) {
  await updateProfile(context.firstProfile.id, { enabled: true });
  await request(`/api/storage/default/${encodeURIComponent(context.originalDefault.id)}`, { method: 'POST' });
  await request(`/api/storage/${encodeURIComponent(context.firstProfile.id)}`, { method: 'DELETE' });
  await request(`/api/storage/${encodeURIComponent(context.secondProfile.id)}`, { method: 'DELETE' });
}

async function cleanup(context, upload) {
  try {
    if (upload) await deleteUpload(upload);
  } finally {
    await cleanupProfiles(context);
  }
}

async function main() {
  process.stdout.write(`Storage regression start: ${BASE_URL}\n`);
  await login();
  await verifyGuestIsolation();
  const context = await createSameTypeProfiles();
  let upload = null;
  try {
    await verifyPerTypeDefault(context);
    upload = await uploadExact(context.firstProfile);
    await verifyDisabledHistoricalRead(context, upload);
    await verifyProfileStatus(context);
  } finally {
    await cleanup(context, upload);
  }
  process.stdout.write('Storage regression passed.\n');
}

main().catch((error) => {
  process.stderr.write(`Storage regression failed: ${error.stack || error.message}\n`);
  process.exit(1);
});
