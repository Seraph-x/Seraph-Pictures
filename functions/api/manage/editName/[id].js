const PREFIXES = ['img:', 'vid:', 'aud:', 'doc:', 'r2:', 's3:', 'discord:', 'hf:', 'webdav:', 'github:', ''];

function decodeFileId(raw) {
  try {
    return decodeURIComponent(raw || '');
  } catch {
    return String(raw || '');
  }
}

async function getRecordWithKey(env, fileId) {
  const hasKnownPrefix = PREFIXES.some((prefix) => prefix && fileId.startsWith(prefix));
  const candidateKeys = hasKnownPrefix ? [fileId] : PREFIXES.map((prefix) => `${prefix}${fileId}`);

  for (const key of candidateKeys) {
    const record = await env.img_url.getWithMetadata(key);
    if (record?.metadata) {
      return { record, kvKey: key };
    }
  }

  return { record: null, kvKey: fileId };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  if (String(context.request.method || 'GET').toUpperCase() !== 'POST') {
    return methodNotAllowed('POST');
  }
  return editName(context);
}

export async function onRequestPost(context) {
  return editName(context);
}

async function editName(context) {
  const { request, params, env } = context;

  if (!env.img_url) {
    return jsonResponse({ success: false, error: 'KV binding img_url is not configured.' }, 500);
  }

  const payload = await readJsonBody(request);
  const requestedName = String(payload.newName || '').trim();

  if (!requestedName) {
    return jsonResponse({ success: false, error: 'newName is required.' }, 400);
  }

  if (requestedName.length > 180) {
    return jsonResponse({ success: false, error: 'newName is too long.' }, 400);
  }

  const fileId = decodeFileId(params.id);
  const { record, kvKey } = await getRecordWithKey(env, fileId);

  if (!record?.metadata) {
    return jsonResponse({ success: false, error: `Image metadata not found for ID: ${fileId}` }, 404);
  }

  const metadata = {
    ...record.metadata,
    fileName: requestedName,
  };

  await env.img_url.put(kvKey, '', { metadata });

  return jsonResponse({ success: true, fileName: metadata.fileName, key: kvKey });
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ success: false, error: 'Method not allowed.' }), {
    status: 405,
    headers: {
      Allow: allow,
      'Content-Type': 'application/json',
    },
  });
}
