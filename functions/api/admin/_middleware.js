import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';
import { apiError } from '../../utils/api-v1.js';
import { withAuthErrorResponse } from '../../utils/auth/http-errors.js';

async function handleRequest(context) {
  if (!context.env?.img_url) {
    return apiError(
      'SERVER_MISCONFIGURED',
      'KV binding img_url is not configured.',
      500
    );
  }

  if (!isAuthRequired(context.env)) {
    return context.next();
  }

  const authResult = await checkAuthentication(context);
  if (authResult.authenticated) {
    return context.next();
  }

  return apiError('UNAUTHORIZED', 'You need to login.', 401);
}

export const onRequest = withAuthErrorResponse(handleRequest);
