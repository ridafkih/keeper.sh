import { withCompression } from "./compression";
import { isApiRequest, isMcpRequest, proxyRequest } from "./proxy/http";
import { handleInternalRoute } from "./internal-routes";
import { hasSessionCookie } from "@/lib/session-cookie";
import type { Runtime, ServerConfig } from "./types";

const HTML_CACHE_TTL_MS = 60_000;
const PUBLIC_HTML_CACHE_CONTROL = "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";
const PRIVATE_HTML_CACHE_CONTROL = "private, no-store";
const PUBLIC_HTML_VARY = "accept-encoding";

interface CachedHtml {
  body: string;
  cachedAt: number;
  etag: string;
}

const htmlCache = new Map<string, CachedHtml>();

function getCachedHtml(cacheKey: string): CachedHtml | null {
  const entry = htmlCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > HTML_CACHE_TTL_MS) {
    htmlCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function setCachedHtml(cacheKey: string, body: string): CachedHtml {
  const entry = { body, cachedAt: Date.now(), etag: `"${Bun.hash(body).toString(16)}"` };
  htmlCache.set(cacheKey, entry);
  return entry;
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

function withPublicHtmlCacheHeaders(response: Response, etag: string): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", PUBLIC_HTML_CACHE_CONTROL);
  headers.set("etag", etag);
  headers.set("vary", PUBLIC_HTML_VARY);

  return new Response(response.body, {
    headers,
    status: response.status,
  });
}

function withPrivateHtmlCacheHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", PRIVATE_HTML_CACHE_CONTROL);

  return new Response(response.body, {
    headers,
    status: response.status,
  });
}

function notModifiedResponse(etag: string, config: ServerConfig): Response {
  const response = new Response(null, { status: 304 });
  return withSecurityHeaders(withPublicHtmlCacheHeaders(response, etag), config);
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
  const cookieHeader = request.headers.get("cookie") ?? undefined;
  const isAuthenticated = hasSessionCookie(cookieHeader);
  const cacheKey = pathname;
  const isCacheablePath = config.isProduction && runtime.cacheableHtmlPaths.has(pathname);
  const isPubliclyCacheable = isCacheablePath && !isAuthenticated;

  if (isCacheablePath) {
    const cached = getCachedHtml(cacheKey);
    if (cached) {
      if (isPubliclyCacheable && request.headers.get("if-none-match") === cached.etag) {
        return notModifiedResponse(cached.etag, config);
      }

      const cachedResponse = new Response(cached.body, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
      const cacheableResponse = isPubliclyCacheable
        ? withPublicHtmlCacheHeaders(cachedResponse, cached.etag)
        : withPrivateHtmlCacheHeaders(cachedResponse);
      const securedResponse = withSecurityHeaders(cacheableResponse, config);
      return withCompression(request, securedResponse);
    }
  }

  const viteAssets = await runtime.resolveViteAssets(pathname);
  const routerResponse = await runtime.renderApp(request, viteAssets);

  const isRedirect = routerResponse.status >= 300 && routerResponse.status < 400;
  if (isRedirect) {
    return withPrivateHtmlCacheHeaders(routerResponse);
  }

  if (isPubliclyCacheable && routerResponse.status === 200) {
    const body = await routerResponse.text();
    const entry = setCachedHtml(cacheKey, body);
    const freshResponse = new Response(body, {
      headers: routerResponse.headers,
      status: routerResponse.status,
    });
    const cacheableResponse = withPublicHtmlCacheHeaders(freshResponse, entry.etag);
    const securedResponse = withSecurityHeaders(cacheableResponse, config);
    return withCompression(request, securedResponse);
  }

  const securedResponse = withSecurityHeaders(withPrivateHtmlCacheHeaders(routerResponse), config);
  return withCompression(request, securedResponse);
}
