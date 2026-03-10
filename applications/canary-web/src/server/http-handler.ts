import { isApiRequest, isDocumentRequest, proxyRequest } from "./proxy/http";
import { handleInternalRoute } from "./internal-routes";
import type { Runtime, ServerConfig } from "./types";

const baseSecurityHeaders: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const cspHeader =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function withSecurityHeaders(response: Response, config: ServerConfig): Response {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(baseSecurityHeaders)) {
    headers.set(key, value);
  }

  if (config.isProduction) {
    headers.set("content-security-policy", cspHeader);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
  });
}

export async function handleApplicationRequest(
  request: Request,
  runtime: Runtime,
  config: ServerConfig,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const internalRouteResponse = await handleInternalRoute(request);
  if (internalRouteResponse) {
    return internalRouteResponse;
  }

  if (isApiRequest(requestUrl)) {
    return proxyRequest(request, config.apiProxyOrigin);
  }

  if (!isDocumentRequest(request)) {
    return runtime.handleAssetRequest(request);
  }

  const viteAssets = await runtime.resolveViteAssets(requestUrl.pathname);
  const routerResponse = await runtime.renderApp(request, viteAssets);

  const isRedirect = routerResponse.status >= 300 && routerResponse.status < 400;
  if (isRedirect) {
    return routerResponse;
  }

  return withSecurityHeaders(routerResponse, config);
}
