import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./generated/tanstack/route-tree.generated";
import { HttpError } from "./lib/fetcher";
import { getPublicRuntimeConfig, getServerPublicRuntimeConfig } from "./lib/runtime-config";
import type { PublicRuntimeConfig } from "./lib/runtime-config";
import { hasSessionCookie } from "./lib/session-cookie";
import type { AppRouterContext } from "./lib/router-context";

import type { ViteAssets } from "./lib/router-context";

interface CreateAppRouterOptions {
  request?: Request;
  viteAssets?: ViteAssets;
}

function getConfiguredApiOrigin(): string | undefined {
  if (typeof window === "undefined") {
    return process.env.VITE_API_URL;
  }

  return import.meta.env.VITE_API_URL;
}

function resolveApiOrigin(request: Request | undefined): string {
  const configuredApiOrigin = getConfiguredApiOrigin();
  if (configuredApiOrigin && configuredApiOrigin.length > 0) {
    return configuredApiOrigin;
  }

  if (request) {
    return new URL(request.url).origin;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  throw new Error("Unable to resolve API origin.");
}

function resolveWebOrigin(request: Request | undefined): string {
  if (request) {
    return new URL(request.url).origin;
  }

  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  throw new Error("Unable to resolve web origin.");
}

function createJsonFetcher(
  requestCookie: string | null,
  origin: string,
): AppRouterContext["fetchApi"] {
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const requestHeaders = new Headers(init.headers);
    if (requestCookie && !requestHeaders.has("cookie")) {
      requestHeaders.set("cookie", requestCookie);
    }

    const absoluteUrl = new URL(path, origin).toString();
    const response = await fetch(absoluteUrl, {
      ...init,
      credentials: "include",
      headers: requestHeaders,
    });

    if (!response.ok) {
      throw new HttpError(response.status, path);
    }

    return response.json();
  };
}

function createApiFetcher(
  request: Request | undefined,
): AppRouterContext["fetchApi"] {
  const requestCookie = request?.headers.get("cookie") ?? null;
  const apiOrigin = resolveApiOrigin(request);
  return createJsonFetcher(requestCookie, apiOrigin);
}

function createWebFetcher(
  request: Request | undefined,
): AppRouterContext["fetchWeb"] {
  const requestCookie = request?.headers.get("cookie") ?? null;
  const webOrigin = resolveWebOrigin(request);
  return createJsonFetcher(requestCookie, webOrigin);
}

function resolveRuntimeConfig(request: Request | undefined): PublicRuntimeConfig {
  if (request) {
    return getServerPublicRuntimeConfig({
      environment: process.env,
      countryCode: request.headers.get("cf-ipcountry"),
    });
  }

  return getPublicRuntimeConfig();
}

function createSessionChecker(
  request: Request | undefined,
): () => boolean {
  if (request) {
    const cookieHeader = request.headers.get("cookie") ?? undefined;
    const serverHasSession = hasSessionCookie(cookieHeader);
    return () => serverHasSession;
  }

  return () => hasSessionCookie();
}

function buildRouterContext(
  request: Request | undefined,
  viteAssets: ViteAssets | undefined,
): AppRouterContext {
  return {
    auth: {
      hasSession: createSessionChecker(request),
    },
    fetchApi: createApiFetcher(request),
    fetchWeb: createWebFetcher(request),
    runtimeConfig: resolveRuntimeConfig(request),
    viteAssets: viteAssets ?? null,
  };
}

export function createAppRouter(options: CreateAppRouterOptions = {}) {
  const router = createRouter({
    context: buildRouterContext(options.request, options.viteAssets),
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: false,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
