/**
 * Runtime Configuration Endpoint
 * Serves frontend configuration from Cloudflare environment variables
 */

export async function onRequest(context) {
  const { env } = context;

  // Build configuration object from environment variables
  const config = {
    apiGatewayUrl: env.VITE_AI_GATEWAY_URL || '/api/v1',
    modelCN: env.VITE_API_MODEL_CN || 'deepseek-chat-v3.1',
    modelEN: env.VITE_API_MODEL_EN || 'gpt-4o-mini',
  };

  return new Response(JSON.stringify(config), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      'Access-Control-Allow-Origin': '*',
    },
  });
}
