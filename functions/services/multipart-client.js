export class MultipartCoordinatorError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function binding(env) {
  if (!env.UPLOAD_COORDINATOR) throw new MultipartCoordinatorError('MULTIPART_BINDING_MISSING', 503);
  return env.UPLOAD_COORDINATOR;
}

async function readResponse(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.data) {
    throw new MultipartCoordinatorError(body?.error?.code || 'MULTIPART_RESPONSE_INVALID', response.status || 503);
  }
  return body.data;
}

function stubFor(env, uploadId) {
  const namespace = binding(env);
  return namespace.get(namespace.idFromName(uploadId));
}

export async function initializeMultipart(env, input) {
  const response = await stubFor(env, input.uploadId).fetch('https://upload.internal/initialize', {
    method: 'POST', body: JSON.stringify(input),
  });
  return readResponse(response);
}

export async function uploadMultipartPart(env, input) {
  const url = new URL('https://upload.internal/part');
  url.searchParams.set('uploadId', input.uploadId);
  url.searchParams.set('partNumber', String(input.partNumber));
  const response = await stubFor(env, input.uploadId).fetch(url, {
    method: 'PUT', headers: { 'X-Part-SHA256': input.digest }, body: input.bytes,
  });
  return readResponse(response);
}

async function sendJsonOperation(env, input, operation, method) {
  const response = await stubFor(env, input.uploadId).fetch(`https://upload.internal/${operation}`, {
    method, body: JSON.stringify({ uploadId: input.uploadId }),
  });
  return readResponse(response);
}

export function completeMultipart(env, input) {
  return sendJsonOperation(env, input, 'complete', 'POST');
}

export function cancelMultipart(env, input) {
  return sendJsonOperation(env, input, 'cancel', 'DELETE');
}
