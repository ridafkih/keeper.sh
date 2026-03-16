import { withCompression } from "./compression";
import { isApiRequest, isMcpRequest, proxyRequest } from "./proxy/http";
import { handleInternalRoute } from "./internal-routes";
import type { Runtime, ServerConfig } from "./types";

const CACHEABLE_PATHS = new Set(["/", "/blog", "/privacy", "/terms"]);
const HTML_CACHE_TTL_MS = 60_000;

interface CachedHtml {
  body: string;
  cachedAt: number;
}

const htmlCache = new Map<string, CachedHtml>();

function getCachedHtml(pathname: string): string | null {
  const entry = htmlCache.get(pathname);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > HTML_CACHE_TTL_MS) {
    htmlCache.delete(pathname);
    return null;
  }
  return entry.body;
}

function setCachedHtml(pathname: string, body: string): void {
  htmlCache.set(pathname, { body, cachedAt: Date.now() });
}

const baseSecurityHeaders: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

const cspHeader =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://cdn.visitors.now; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://pagead2.googlesyndication.com; font-src 'self'; connect-src 'self' https://www.google-analytics.com https://cdn.visitors.now https://e.visitors.now https://pagead2.googlesyndication.com; frame-src https://polar.sh; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

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
  const internalRouteResponse = await handleInternalRoute(request, config);
  if (internalRouteResponse) {
    return internalRouteResponse;
  }

  if (isMcpRequest(requestUrl) && config.mcpProxyOrigin) {
    return proxyRequest(request, config.mcpProxyOrigin);
  }

  if (isApiRequest(requestUrl)) {
    return proxyRequest(request, config.apiProxyOrigin);
  }

  const assetResponse = await runtime.handleAssetRequest(request);
  if (assetResponse.status !== 404) {
    return withCompression(request, assetResponse);
  }

  const pathname = requestUrl.pathname;

  if (config.isProduction && CACHEABLE_PATHS.has(pathname)) {
    const cached = getCachedHtml(pathname);
    if (cached) {
      const cachedResponse = new Response(cached, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      const securedResponse = withSecurityHeaders(cachedResponse, config);
      return withCompression(request, securedResponse);
    }
  }

  const viteAssets = await runtime.resolveViteAssets(pathname);
  const routerResponse = await runtime.renderApp(request, viteAssets);

  const isRedirect = routerResponse.status >= 300 && routerResponse.status < 400;
  if (isRedirect) {
    return routerResponse;
  }

  if (config.isProduction && CACHEABLE_PATHS.has(pathname)) {
    const body = await routerResponse.text();
    setCachedHtml(pathname, body);
    const freshResponse = new Response(body, {
      headers: routerResponse.headers,
      status: routerResponse.status,
    });
    const securedResponse = withSecurityHeaders(freshResponse, config);
    return withCompression(request, securedResponse);
  }

  const securedResponse = withSecurityHeaders(routerResponse, config);
  return withCompression(request, securedResponse);
}
