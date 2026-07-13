import { AuthCoordinatorError } from './errors.js';

export function createAuthErrorResponse(error) {
  if (!(error instanceof AuthCoordinatorError)) return null;
  return new Response(JSON.stringify({
    success: false,
    message: '认证服务暂不可用',
    error: { code: error.code },
  }), {
    status: error.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function withAuthErrorResponse(handler) {
  return async function authErrorBoundary(context) {
    try {
      return await handler(context);
    } catch (error) {
      const response = createAuthErrorResponse(error);
      if (response) return response;
      throw error;
    }
  };
}
