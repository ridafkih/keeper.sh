import fs from "node:fs/promises";
import path from "node:path";
import { clientDistDirectory } from "@/server/paths";

export function isMcpRequest(url: URL): boolean {
  return url.pathname === "/mcp";
}

export function isApiRequest(url: URL): boolean {
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

export function toProxiedUrl(requestUrl: URL, origin: string): URL {
  const upstreamUrl = new URL(origin);
  return new URL(requestUrl.pathname + requestUrl.search, upstreamUrl);
}

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

const EDGE_ONLY_HEADERS = ["x-origin-auth"];

const UNFORWARDED_REQUEST_HEADERS = ["host", ...HOP_BY_HOP_HEADERS, ...EDGE_ONLY_HEADERS];

export function toForwardedHeaders(headers: Headers): Headers {
  const forwarded = new Headers(headers);
  for (const name of UNFORWARDED_REQUEST_HEADERS) {
    forwarded.delete(name);
  }
  return forwarded;
}

export async function proxyRequest(request: Request, origin: string): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetUrl = toProxiedUrl(requestUrl, origin);
  const requestHeaders = toForwardedHeaders(request.headers);

  const requestInit: RequestInit = {
    headers: requestHeaders,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.body = request.body;
  }

  return fetch(targetUrl, requestInit);
}

function resolveStaticFilePath(pathname: string): string | null {
  if (pathname === "/" || pathname === "/index.html") {
    return null;
  }

  const normalizedPath = pathname.replace(/^\/+/, "");
  if (normalizedPath.length === 0) {
    return null;
  }

  const candidatePath = path.resolve(clientDistDirectory, normalizedPath);
  if (!candidatePath.startsWith(clientDistDirectory)) {
    return null;
  }

  return candidatePath;
}

function getCacheControlHeader(pathname: string): string {
  if (pathname.startsWith("/assets/")) {
    return "public, max-age=31536000, immutable";
  }

  if (pathname.startsWith("/integrations/") || pathname.startsWith("/contributors/")) {
    return "public, max-age=604800, stale-while-revalidate=86400";
  }

  return "public, max-age=3600, stale-while-revalidate=86400";
}

export async function readStaticFile(pathname: string): Promise<Response> {
  const candidatePath = resolveStaticFilePath(pathname);
  if (!candidatePath) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const fileStat = await fs.stat(candidatePath);
    if (!fileStat.isFile()) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(Bun.file(candidatePath), {
      headers: {
        "cache-control": getCacheControlHeader(pathname),
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
