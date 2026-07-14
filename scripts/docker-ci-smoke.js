#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const SMOKE_TYPE = String(process.env.MULTI_PROFILE_SMOKE_TYPE || '').trim().toLowerCase();
const SMOKE_CONFIG_JSON = String(process.env.MULTI_PROFILE_SMOKE_CONFIG_JSON || '').trim();

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return Object.freeze({
    code: Number(result.status == null ? 1 : result.status),
    stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim(),
    error: result.error || null,
  });
}

function runComposeExec(script) {
  return runCommand('docker', ['compose', 'exec', '-T', 'api', 'sh', '-lc', script]);
}

function runComposeNode(script) {
  return runCommand('docker', ['compose', 'exec', '-T', 'api', 'node', '-e', script]);
}

function parseJson(text, label) {
  try { return JSON.parse(String(text)); }
  catch (cause) { throw Object.assign(new Error(`${label}_JSON_INVALID`), { cause }); }
}

function sleepMs(milliseconds) {
  const result = spawnSync(process.execPath, ['-e', `setTimeout(() => {}, ${milliseconds})`]);
  if (result.status !== 0) throw new Error('SMOKE_WAIT_FAILED');
}

function waitForApi() {
  const maxAttempts = 60;
  const intervalMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const health = runComposeExec('wget -qO- http://localhost:8787/api/health');
    if (health.code === 0) return;
    process.stdout.write(`API wait attempt ${attempt}/${maxAttempts}\n`);
    sleepMs(intervalMs);
  }
  throw new Error('API did not become ready in time.');
}

function apiRequest(options) {
  const encoded = Buffer.from(JSON.stringify(options)).toString('base64');
  const script = [
    `const options=JSON.parse(Buffer.from('${encoded}','base64').toString());`,
    "const raw=`${process.env.BASIC_USER}:${process.env.BASIC_PASS}`;",
    "const authorization=Buffer.from(raw).toString('base64');",
    "const authHeaders=options.authenticated===false?{}:{Authorization: `Basic ${authorization}`};",
    "const headers={...authHeaders,...(options.headers||{})};",
    'let body=options.body?JSON.stringify(options.body):undefined;',
    "if(options.body)headers['Content-Type']='application/json';",
    "if(options.file){body=new FormData();body.append('file',new File(['blocked'],'blocked.txt',{type:'text/plain'}));body.append('storageMode',options.file.storageMode);body.append('storageId',options.file.storageId);}",
    "fetch(`http://localhost:8787${options.path}`,{method:options.method||'GET',headers,body})",
    '.then(async(response)=>{const text=await response.text();let payload;try{payload=JSON.parse(text)}catch(cause){throw new Error(`API_RESPONSE_JSON_INVALID: ${text}`)}process.stdout.write(JSON.stringify({status:response.status,payload}));})',
    ".catch((error)=>{process.stderr.write(`${error.stack||error.message}\\n`);process.exit(1)});",
  ].join('');
  const result = runComposeNode(script);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || 'API_REQUEST_FAILED');
  return parseJson(result.stdout, 'API_RESPONSE');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireSuccess(result, label) {
  const error = result.payload?.error?.code || result.payload?.errorCode || result.payload?.error;
  assert(result.status < 400 && result.payload?.success === true, `${label}: ${error || result.status}`);
  return result.payload;
}

function smokeConfig() {
  assert(SMOKE_TYPE, 'MULTI_PROFILE_SMOKE_TYPE is required.');
  assert(SMOKE_CONFIG_JSON, 'MULTI_PROFILE_SMOKE_CONFIG_JSON is required.');
  return parseJson(SMOKE_CONFIG_JSON, 'MULTI_PROFILE_SMOKE_CONFIG');
}

function listProfiles() {
  return requireSuccess(apiRequest({ path: '/api/storage/list' }), 'storage list').items;
}

function createProfile(name) {
  const payload = requireSuccess(apiRequest({
    path: '/api/storage', method: 'POST',
    body: { name, type: SMOKE_TYPE, enabled: true, isDefault: false, config: smokeConfig() },
  }), `create ${name}`);
  assert(payload.item?.id, `create ${name} returned no ID`);
  return payload.item;
}

function createSameTypeProfiles() {
  const originalDefault = listProfiles().find((item) => item.type === SMOKE_TYPE && item.isDefault);
  assert(originalDefault, `No existing ${SMOKE_TYPE} default profile.`);
  const suffix = `${Date.now()}-${process.pid}`;
  const firstProfile = createProfile(`ci-first-${suffix}`);
  const secondProfile = createProfile(`ci-second-${suffix}`);
  return { firstProfile, secondProfile, originalDefault, fileId: `ci-history-${suffix}` };
}

function verifyPerTypeDefault(context) {
  requireSuccess(apiRequest({
    path: `/api/storage/default/${encodeURIComponent(context.secondProfile.id)}`, method: 'POST',
  }), 'set same-type default');
  const defaults = listProfiles().filter((item) => item.type === SMOKE_TYPE && item.isDefault);
  assert(defaults.length === 1, 'Same-type profiles do not have exactly one default.');
  assert(defaults[0].id === context.secondProfile.id, 'Selected same-type default was not persisted.');
}

function updateProfile(id, patch) {
  return requireSuccess(apiRequest({
    path: `/api/storage/${encodeURIComponent(id)}`, method: 'PUT', body: patch,
  }), `update profile ${id}`).item;
}

function seedHistoricalFile(context) {
  const input = Buffer.from(JSON.stringify({
    id: context.fileId, storageConfigId: context.firstProfile.id,
    storageType: context.firstProfile.type, storageKey: 'ci-history-key',
    fileName: 'ci-history.txt', fileSize: 4, mimeType: 'text/plain',
    extra: { visibility: 'private', accessVersion: 1, storageName: context.firstProfile.name },
  })).toString('base64');
  const script = `const {createContainer}=require('./lib/container');const c=createContainer(process.env);const file=JSON.parse(Buffer.from('${input}','base64'));c.fileRepo.create(file);process.stdout.write(file.id);`;
  const result = runComposeNode(script);
  assert(result.code === 0 && result.stdout === context.fileId, result.stderr || 'HISTORICAL_SEED_FAILED');
}

function errorCode(payload) {
  return payload?.error?.code || payload?.errorCode || payload?.code || '';
}

function verifyDisabledHistoricalRead(context) {
  updateProfile(context.firstProfile.id, { enabled: false });
  seedHistoricalFile(context);
  const query = new URLSearchParams({ storageId: context.firstProfile.id });
  const explorer = requireSuccess(apiRequest({ path: `/api/drive/explorer?${query}` }), 'historical explorer');
  assert(explorer.files.some((file) => file.name === context.fileId), 'Disabled historical file is hidden.');
  const blocked = apiRequest({
    path: '/upload', method: 'POST',
    file: { storageMode: context.firstProfile.type, storageId: context.firstProfile.id },
  });
  assert(errorCode(blocked.payload) === 'STORAGE_CONFIG_DISABLED', 'STORAGE_CONFIG_DISABLED not returned.');
}

function verifyGuestIsolation() {
  const list = apiRequest({ path: '/api/storage/list', authenticated: false });
  assert([401, 403].includes(list.status), 'Guest enumerated storage profiles.');
  const status = apiRequest({ path: '/api/status', authenticated: false });
  assert(!Object.hasOwn(status.payload, 'storageProfiles'), 'Guest status exposed storageProfiles.');
}

function verifyProfileStatus(context) {
  const status = apiRequest({ path: '/api/status' });
  assert(Array.isArray(status.payload.storageProfiles), 'Profile-aware status list is missing.');
  const first = status.payload.storageProfiles.find((item) => item.storageId === context.firstProfile.id);
  const second = status.payload.storageProfiles.find((item) => item.storageId === context.secondProfile.id);
  assert(first?.enabled === false, 'Disabled exact profile status is missing.');
  assert(second?.storageId === context.secondProfile.id, 'Second exact profile status is missing.');
}

function removeHistoricalFile(fileId) {
  const encoded = Buffer.from(fileId).toString('base64');
  const script = `const {createContainer}=require('./lib/container');const c=createContainer(process.env);if(!c.fileRepo.delete(Buffer.from('${encoded}','base64').toString()))process.exit(2);`;
  const result = runComposeNode(script);
  assert(result.code === 0, result.stderr || 'HISTORICAL_DELETE_FAILED');
}

function cleanup(context) {
  removeHistoricalFile(context.fileId);
  updateProfile(context.firstProfile.id, { enabled: true });
  requireSuccess(apiRequest({
    path: `/api/storage/default/${encodeURIComponent(context.originalDefault.id)}`, method: 'POST',
  }), 'restore original default');
  for (const profile of [context.firstProfile, context.secondProfile]) {
    requireSuccess(apiRequest({
      path: `/api/storage/${encodeURIComponent(profile.id)}`, method: 'DELETE',
    }), `delete ${profile.id}`);
  }
}

function validateBootstrapStatus() {
  const status = apiRequest({ path: '/api/status' }).payload;
  for (const key of ['huggingface', 'github']) {
    assert(status[key]?.configured === true, `${key} should be configured.`);
  }
}

function runMultiProfileSmoke() {
  verifyGuestIsolation();
  const context = createSameTypeProfiles();
  try {
    verifyPerTypeDefault(context);
    verifyDisabledHistoricalRead(context);
    verifyProfileStatus(context);
  } finally {
    cleanup(context);
  }
}

function main() {
  process.stdout.write('Running Docker CI storage smoke checks.\n');
  try {
    const compose = runCommand('docker', ['compose', 'ps']);
    assert(compose.code === 0, compose.stderr || 'docker compose ps failed.');
    waitForApi();
    validateBootstrapStatus();
    runMultiProfileSmoke();
    process.stdout.write('Docker CI storage smoke checks passed.\n');
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(2);
  }
}

main();
