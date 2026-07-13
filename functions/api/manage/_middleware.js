import { 
  checkAuthentication,
  isAuthRequired 
} from '../../utils/auth.js';
import { createAuthErrorResponse } from '../../utils/auth/http-errors.js';

async function errorHandling(context) {
    try {
      return await context.next();
    } catch (err) {
      const authError = createAuthErrorResponse(err);
      if (authError) return authError;
      console.error('Unhandled error in manage API:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  async function authentication(context) {
    // 检查 KV 是否绑定
    if (typeof context.env.img_url == "undefined" || context.env.img_url == null || context.env.img_url == "") {
        return new Response('Dashboard is disabled. Please bind a KV namespace to use this feature.', { status: 503 });
    }

    // 如果没有配置认证，直接放行
    if (!isAuthRequired(context.env)) {
        return context.next();
    }
    
    // 使用统一的认证检查（支持 Cookie session 和 Basic Auth）
    const authResult = await checkAuthentication(context);
    
    if (authResult.authenticated) {
        return context.next();
    }
    
    // 认证失败，返回 401
    return new Response('You need to login.', {
        status: 401,
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
          'Cache-Control': 'no-store',
        },
    });
  }
  
  export const onRequest = [errorHandling, authentication];
