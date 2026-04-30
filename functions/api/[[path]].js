/**
 * 通用 LLM API 网关 - Cloudflare Pages Functions 版本
 * 支持全路径转发、流式响应、跨域管控、多租户鉴权
 */

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  // 1. 环境参数检查
  const upstreamUrl = env.UPSTREAM_API_URL;
  const upstreamKey = env.UPSTREAM_API_KEY;
  if (!upstreamUrl || !upstreamKey) {
    return jsonError("Gateway configuration error: Missing Upstream URL or Key", 500);
  }

  // 2. 路径处理：从 URL 中提取完整路径
  // 例如：/api/v1/chat/completions -> /v1/chat/completions
  const apiPrefix = '/api';
  const fullPath = url.pathname.startsWith(apiPrefix) 
    ? url.pathname.slice(apiPrefix.length) 
    : url.pathname;
  
  // 构建目标 URL
  const targetUrl = new URL(upstreamUrl.replace(/\/+$/, '') + fullPath);
  targetUrl.search = url.search;

  // 安全屏蔽：防止泄露模型列表或进行未授权探测
  if (fullPath.endsWith('/models') || fullPath === '/v1/models') {
    return jsonError("Model listing is disabled for security", 403);
  }

  // 3. 跨域 (CORS) 与 鉴权 (Auth)
  const origin = request.headers.get('Origin');
  const isAllowedOrigin = checkOrigin(origin, env.ALLOWED_ORIGINS);

  // 处理 Preflight 请求
  if (request.method === 'OPTIONS') {
    if (isAllowedOrigin) {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    return jsonError("Forbidden: Origin not allowed", 403);
  }

  // 混合鉴权逻辑
  if (origin && isAllowedOrigin) {
    // 情况 A：来自受信前端项目的浏览器请求，放行（靠 Origin 保护）
  } else {
    // 情况 B：来自脚本或其他后端项目，必须校验网关密钥
    const clientKey = extractBearerToken(request.headers.get('Authorization'));
    const validKeys = (env.GATEWAY_API_KEYS || "").split(',').map(k => k.trim());
    
    if (!clientKey || !validKeys.includes(clientKey)) {
      return jsonError("Unauthorized: Valid Gateway API Key required", 401);
    }
  }

  // 4. 构建转发请求
  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set('Authorization', `Bearer ${upstreamKey}`);
  proxyHeaders.delete('Host');
  proxyHeaders.delete('CF-Connecting-IP');

  const proxyRequest = new Request(targetUrl.toString(), {
    method: request.method,
    headers: proxyHeaders,
    body: request.body,
    redirect: 'follow',
  });

  try {
    const response = await fetch(proxyRequest);
    
    // 5. 处理响应：支持流式传输
    const responseHeaders = new Headers(response.headers);
    if (isAllowedOrigin && origin) {
      responseHeaders.set('Access-Control-Allow-Origin', origin);
    }

    // Log errors for debugging
    if (!response.ok) {
      console.error(`Upstream error: ${response.status} ${response.statusText}`);
      console.error(`Target URL: ${targetUrl.toString()}`);
      const errorBody = await response.text();
      console.error(`Error body: ${errorBody}`);
      
      return new Response(errorBody || JSON.stringify({ 
        error: { 
          message: `Upstream API error: ${response.status} ${response.statusText}`,
          status: response.status 
        } 
      }), {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Gateway fetch error: ${err.message}`);
    console.error(`Target URL: ${targetUrl.toString()}`);
    return jsonError(`Gateway Error: ${err.message}`, 502);
  }
}

// --- 辅助函数 ---

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: { message, status } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function checkOrigin(origin, allowedStr) {
  if (!origin || !allowedStr) return false;
  const allowed = allowedStr.split(',').map(o => o.trim());
  return allowed.some(pattern => {
    if (pattern === origin) return true;
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[a-zA-Z0-9-]+') + '$');
      return regex.test(origin);
    }
    return false;
  });
}

function extractBearerToken(header) {
  if (!header) return null;
  const [type, token] = header.split(' ');
  return type.toLowerCase() === 'bearer' ? token : null;
}
