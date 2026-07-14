import {
  addCorsHeaders,
  addResponseHeaders,
  blockRedirect,
  errorResponse,
  getMimeType,
  shouldBlock,
  shouldWhitelistDeny,
} from './common.js';

function parseRange(value) {
  const match = String(value || '').match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const start = match[1] ? Number.parseInt(match[1], 10) : null;
  const end = match[2] ? Number.parseInt(match[2], 10) : null;
  return start === null && end === null ? null : Object.freeze({ start, end });
}

function resolveRange(range, totalSize) {
  const start = range.start === null ? Math.max(totalSize - range.end, 0) : range.start;
  const end = range.start === null
    ? totalSize - 1
    : Math.min(range.end ?? (totalSize - 1), totalSize - 1);
  return Object.freeze({ start, end });
}

async function readR2Object(env, key, rangeHeader) {
  if (!rangeHeader) return Object.freeze({ object: await env.R2_BUCKET.get(key), range: null });
  const parsed = parseRange(rangeHeader);
  if (!parsed) return Object.freeze({ object: await env.R2_BUCKET.get(key), range: null });
  const head = await env.R2_BUCKET.head(key);
  if (!head) return Object.freeze({ object: null, range: null });
  const range = resolveRange(parsed, head.size);
  if (range.start >= head.size || range.start > range.end) {
    return Object.freeze({ object: null, range: { invalid: true, totalSize: head.size } });
  }
  const object = await env.R2_BUCKET.get(key, {
    range: { offset: range.start, length: range.end - range.start + 1 },
  });
  return Object.freeze({ object, range: { ...range, totalSize: head.size } });
}

function invalidRangeResponse(totalSize) {
  const headers = addCorsHeaders(new Headers());
  headers.set('Content-Range', `bytes */${totalSize}`);
  return new Response('Range Not Satisfiable', { status: 416, headers });
}

export async function handleR2File({ context, r2Key, record, adapter }) {
  const { request, env } = context;
  if (!record?.metadata) return errorResponse('File not found', 404);
  const requestUrl = new URL(request.url);
  if (shouldBlock(record.metadata)) return blockRedirect(requestUrl, request);
  if (shouldWhitelistDeny(env, record.metadata)) {
    return Response.redirect(`${requestUrl.origin}/whitelist-on.html`, 302);
  }
  const key = r2Key.replace(/^r2:/, '');
  if (adapter?.mode === 's3') return handleS3Mode({ context, key, record, adapter });
  if (!adapter?.binding) return errorResponse('R2 storage not configured', 500);
  const bindingEnv = Object.freeze({ ...env, R2_BUCKET: adapter.binding });
  const result = await readR2Object(bindingEnv, key, request.headers.get('Range'));
  if (result.range?.invalid) return invalidRangeResponse(result.range.totalSize);
  if (!result.object) return errorResponse('File not found in R2', 404);
  const fileName = record.metadata.fileName || key;
  const headers = new Headers();
  addResponseHeaders({ headers, fileName, mimeType: getMimeType(fileName) });
  if (result.range) {
    const { start, end, totalSize } = result.range;
    headers.set('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    headers.set('Content-Length', String(end - start + 1));
    return new Response(result.object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(result.object.size));
  return new Response(result.object.body, { status: 200, headers });
}

async function handleS3Mode({ context, key, record, adapter }) {
  const range = context.request.headers.get('Range');
  const upstream = await adapter.client.getObject(key, range ? { range } : {});
  if (!upstream) return errorResponse('File not found in R2', 404);
  const fileName = record.metadata.fileName || key;
  const headers = new Headers();
  addResponseHeaders({ headers, fileName, mimeType: getMimeType(fileName), upstream });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
