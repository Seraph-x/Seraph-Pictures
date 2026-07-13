import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { cancelMultipart } from '../../services/multipart-client.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestDelete(context) {
  try {
    if (isAuthRequired(context.env)) {
      const auth = await checkAuthentication(context);
      if (!auth.authenticated) return json({ error: 'Unauthorized' }, 401);
    }
    const { uploadId } = await context.request.json();
    if (!uploadId) return json({ error: 'MULTIPART_PAYLOAD_INVALID' }, 400);
    return json({ success: true, ...(await cancelMultipart(context.env, { uploadId })) });
  } catch (error) {
    return json({ error: error.message, code: error.code }, error.status || 500);
  }
}
