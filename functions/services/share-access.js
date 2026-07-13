import { callCoordinator } from '../utils/auth/coordinator-client.js';
import sharePolicy from '../../shared/security/share-policy.cjs';

const {
  buildSharePayload,
  decideShareUse,
  eligibleShareSecrets,
  normalizeShareRequest,
} = sharePolicy;
import rangeLeasePolicy from '../../shared/security/range-lease.cjs';

const { parseRangeRequest, parseRangeResponse } = rangeLeasePolicy;
const PASSWORD_ITERATIONS = 100_000;
const PASSWORD_DERIVED_BITS = 256;
const RANDOM_ID_BYTES = 24;
const PASSWORD_SALT_BYTES = 16;
const LEASE_COOKIE_PREFIX = 'seraph_share_lease_';
const LEASE_ID_BYTES = 16;
const LEASE_TOKEN_BYTES = 24;

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteLength) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacHex(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return bytesToHex(new Uint8Array(signature));
}

async function pbkdf2Hex(password, salt, iterations = PASSWORD_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations,
  }, material, PASSWORD_DERIVED_BITS);
  return bytesToHex(new Uint8Array(bits));
}

async function createPasswordHash(password) {
  if (!password) return null;
  const salt = randomHex(PASSWORD_SALT_BYTES);
  return `pbkdf2:${PASSWORD_ITERATIONS}:${salt}:${await pbkdf2Hex(password, salt)}`;
}

async function verifyPassword(password, encoded) {
  if (!encoded) return true;
  const [algorithm, iterationsRaw, salt, expected] = String(encoded).split(':');
  const iterations = Number(iterationsRaw);
  if (algorithm !== 'pbkdf2' || !Number.isInteger(iterations) || !salt || !expected) return false;
  const actual = await pbkdf2Hex(String(password || ''), salt, iterations);
  return constantTimeEqual(actual, expected);
}

function shareSecrets(env, nowMs) {
  return eligibleShareSecrets({
    current: String(env.FILE_SHARE_SECRET_CURRENT || ''),
    previous: String(env.FILE_SHARE_SECRET_PREVIOUS || ''),
    previousValidUntil: Number(env.FILE_SHARE_SECRET_PREVIOUS_VALID_UNTIL),
    nowMs,
  });
}

export function signShareRecord(record, secret) {
  return hmacHex(secret, buildSharePayload(record));
}

export async function verifyShareSignature({ env, record, signature, nowMs = Date.now() }) {
  if (typeof signature !== 'string' || !signature) return false;
  for (const secret of shareSecrets(env, nowMs)) {
    const expected = await signShareRecord(record, secret);
    if (constantTimeEqual(expected, signature)) {
      return true;
    }
  }
  return false;
}

function sharePath(record, signature) {
  const query = new URLSearchParams({ exp: String(record.expiresAt), sig: signature });
  return `/s/${encodeURIComponent(record.shareId)}?${query.toString()}`;
}

export async function createCloudflareShare(options) {
  const nowMs = options.nowMs ?? Date.now();
  const normalized = normalizeShareRequest({ ...options, nowMs });
  const record = Object.freeze({
    shareId: options.shareId || randomHex(RANDOM_ID_BYTES),
    ...normalized,
    revoked: false,
    passwordHash: await createPasswordHash(String(options.password || '')),
    downloadCount: 0,
    createdAt: nowMs,
  });
  const created = await callCoordinator(options.env, 'shareCreate', record);
  if (!created.ok) throw Object.assign(new Error(created.code), { code: created.code });
  const signature = await signShareRecord(record, shareSecrets(options.env, nowMs)[0]);
  return Object.freeze({
    ...record,
    signature,
    sharePath: sharePath(record, signature),
  });
}

function matchesEnvelope({ record, fileId, accessVersion, expiresAt }) {
  return record?.fileId === fileId
    && record.accessVersion === accessVersion
    && record.expiresAt === expiresAt;
}

function fileAccessEnvelope(record) {
  return Object.freeze({
    expiresAt: Math.floor(record.expiresAt / 1000),
    accessVersion: record.accessVersion,
    revoked: false,
  });
}

function leaseCookieName(shareId) {
  return `${LEASE_COOKIE_PREFIX}${shareId}`;
}

function readCookie(request, name) {
  const pairs = (request.headers.get('Cookie') || '').split(';');
  const match = pairs.map((pair) => pair.trim()).find((pair) => pair.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : '';
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return bytesToHex(new Uint8Array(digest));
}

function readLeaseCookie(request, shareId) {
  const value = readCookie(request, leaseCookieName(shareId));
  const [leaseId, token] = value.split('.');
  return leaseId && token ? Object.freeze({ leaseId, token }) : null;
}

async function createLeaseCredentials() {
  const token = randomHex(LEASE_TOKEN_BYTES);
  return Object.freeze({
    leaseId: randomHex(LEASE_ID_BYTES), token, tokenHash: await tokenHash(token),
  });
}

function withLeaseCookie({ response, record, credentials, clear = false }) {
  const headers = new Headers(response.headers);
  const maxAge = clear ? 0 : Math.max(0, Math.floor((record.expiresAt - Date.now()) / 1000));
  headers.set('Cache-Control', 'private, no-store');
  const value = clear ? '' : `${credentials.leaseId}.${credentials.token}`;
  headers.append('Set-Cookie', `${leaseCookieName(record.shareId)}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`);
  return new Response(response.body, { status: response.status, headers });
}

async function readRangeLease({ context, record, range, nowMs }) {
  const credentials = readLeaseCookie(context.request, record.shareId);
  if (!credentials) return null;
  const result = await callCoordinator(context.env, 'shareLeaseRead', {
    shareId: record.shareId,
    leaseId: credentials.leaseId,
    tokenHash: await tokenHash(credentials.token),
    rangeStart: range.start,
    nowMs,
  });
  return result.allowed ? credentials : null;
}

export async function authorizeCloudflareShare(options) {
  const { context, fileId, accessVersion, nowMs = Date.now() } = options;
  const url = new URL(context.request.url);
  const shareId = url.searchParams.get('share') || '';
  const expiresAt = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') || '';
  if (!shareId || !Number.isFinite(expiresAt) || !signature) return null;
  const { record } = await callCoordinator(context.env, 'shareRead', { shareId });
  if (!matchesEnvelope({ record, fileId, accessVersion, expiresAt })) return null;
  if (!await verifyShareSignature({ env: context.env, record, signature, nowMs })) return null;
  const range = parseRangeRequest(context.request.headers.get('Range'));
  if (!range.valid) return null;
  const rangeLimited = Number.isInteger(record.maxDownloads);
  const lease = rangeLimited && range.present
    ? await readRangeLease({ context, record, range, nowMs })
    : null;
  if (rangeLimited && range.present && !lease && range.start !== 0) return null;
  const password = context.request.headers.get('X-Share-Password') || '';
  const passwordVerified = Boolean(lease)
    || await verifyPassword(password, record.passwordHash);
  const decision = decideShareUse({
    record: lease ? { ...record, maxDownloads: null } : record,
    nowMs,
    expectedAccessVersion: accessVersion,
    passwordVerified,
  });
  if (!decision.allowed) return null;
  return Object.freeze({
    access: fileAccessEnvelope(record),
    record,
    passwordVerified,
    lease,
    range,
    rangeLimited,
  });
}

async function consumeShare(context, authorization, nowMs) {
  return callCoordinator(context.env, 'shareConsume', {
    shareId: authorization.record.shareId,
    nowMs,
    expectedAccessVersion: authorization.record.accessVersion,
    passwordVerified: authorization.passwordVerified,
  });
}

async function startRangeLease({ context, authorization, response, range, nowMs }) {
  if (range.complete) return response;
  const credentials = await createLeaseCredentials();
  const started = await callCoordinator(context.env, 'shareConsumeStartLease', {
    shareId: authorization.record.shareId,
    leaseId: credentials.leaseId,
    tokenHash: credentials.tokenHash,
    rangeStart: range.start,
    nextOffset: range.nextOffset,
    expiresAt: authorization.record.expiresAt,
    nowMs,
    expectedAccessVersion: authorization.record.accessVersion,
    passwordVerified: authorization.passwordVerified,
  });
  if (!started.ok) return new Response('File not found', { status: 404 });
  return withLeaseCookie({ response, record: authorization.record, credentials });
}

async function advanceRangeLease({ context, authorization, response, range, nowMs }) {
  const next = await createLeaseCredentials();
  const advanced = await callCoordinator(context.env, 'shareLeaseAdvance', {
    shareId: authorization.record.shareId,
    leaseId: authorization.lease.leaseId,
    tokenHash: await tokenHash(authorization.lease.token),
    rangeStart: range.start,
    nextLeaseId: next.leaseId,
    nextTokenHash: next.tokenHash,
    nextOffset: range.nextOffset,
    complete: range.complete,
    nowMs,
  });
  if (!advanced.ok) return new Response('File not found', { status: 404 });
  return withLeaseCookie({
    response, record: authorization.record, credentials: next, clear: range.complete,
  });
}

export async function finalizeCloudflareShare(options) {
  const { context, authorization, response, nowMs = Date.now() } = options;
  if (!authorization || context.request.method !== 'GET') return response;
  if (![200, 206].includes(response.status)) return response;
  if (!authorization.rangeLimited) return response;
  const range = parseRangeResponse(response.headers.get('Content-Range'));
  if (authorization.range.present && (!range || range.start !== authorization.range.start)) {
    return new Response('File not found', { status: 404 });
  }
  if (authorization.lease) {
    return advanceRangeLease({ context, authorization, response, range, nowMs });
  }
  if (range) return startRangeLease({ context, authorization, response, range, nowMs });
  const consumed = await consumeShare(context, authorization, nowMs);
  return consumed.ok ? response : new Response('File not found', { status: 404 });
}

export async function readCloudflareShare(env, shareId) {
  return callCoordinator(env, 'shareRead', { shareId });
}

export async function revokeCloudflareShare(env, shareId) {
  return callCoordinator(env, 'shareRevoke', { shareId });
}
