import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./generated/tanstack/route-tree.generated";
import { HttpError } from "./lib/fetcher";
import { hasSessionCookie } from "./lib/session-cookie";
import type { AppRouterContext } from "./lib/router-context";

interface CreateAppRouterOptions {
  request?: Request;
}

function resolveApiOrigin(request: Request | undefined): string {
  const configuredApiOrigin = import.meta.env.VITE_API_URL;
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

function createApiFetcher(
  request: Request | undefined,
): AppRouterContext["fetchApi"] {
  const requestCookie = request?.headers.get("cookie");
  const apiOrigin = resolveApiOrigin(request);

  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const headers = new Headers(init.headers);
    if (requestCookie && !headers.has("cookie")) {
      headers.set("cookie", requestCookie);
    }

    const absoluteUrl = new URL(path, apiOrigin).toString();
    const response = await fetch(absoluteUrl, {
      ...init,
      credentials: "include",
      headers,
    });

    if (!response.ok) {
      throw new HttpError(response.status, path);
    }

    return response.json();
  };
}

function buildRouterContext(request: Request | undefined): AppRouterContext {
  const cookieHeader = request?.headers.get("cookie") ?? undefined;
  const serverHasSession = hasSessionCookie(cookieHeader);

  return {
    auth: {
      hasSession: () =>
        request ? serverHasSession : hasSessionCookie(),
    },
    fetchApi: createApiFetcher(request),
  };
}

export function createAppRouter(options: CreateAppRouterOptions = {}) {
  const router = createRouter({
    context: buildRouterContext(options.request),
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
