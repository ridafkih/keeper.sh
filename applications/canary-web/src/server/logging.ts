import { widelog, widelogger } from "widelogger";
import type { ServerConfig } from "./types";

const loggerServiceName = "keeper-web";
const UUID_SEGMENT_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_SEGMENT_PATTERN = /^\d{2,}$/;
const NORMALIZED_PATH_CACHE_MAX_SIZE = 1024;
const normalizedPathCache = new Map<string, string>();

const { context: runWebWideEventContext, destroy: destroyWideLogger } = widelogger({
  defaultEventName: "wide_event",
  environment: process.env.ENV ?? process.env.NODE_ENV,
  service: loggerServiceName,
  version: process.env.npm_package_version,
  commitHash: process.env.COMMIT_SHA,
});

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = Reflect.get(error, "name");
  return name === "AbortError";
}

function normalizeOperationPath(pathname: string): string {
  const cachedPath = normalizedPathCache.get(pathname);
  if (cachedPath !== undefined) {
    normalizedPathCache.delete(pathname);
    normalizedPathCache.set(pathname, cachedPath);
    return cachedPath;
  }

  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const isAssetsPath = segments[0] === "assets";

  if (isAssetsPath) {
    const normalizedAssetsPath = "/assets/:asset";
    setNormalizedPathCache(pathname, normalizedAssetsPath);
    return normalizedAssetsPath;
  }

  const normalizedSegments: string[] = [];

  for (const [index, segment] of segments.entries()) {
    const previousSegments = normalizedSegments.slice(Math.max(0, index - 2), index);
    const [firstPreviousSegment, secondPreviousSegment] = previousSegments;
    const isApiCalIdentifierSegment =
      previousSegments.length === 2 &&
      firstPreviousSegment === "api" &&
      secondPreviousSegment === "cal";

    if (
      isApiCalIdentifierSegment ||
      UUID_SEGMENT_PATTERN.test(segment) ||
      NUMERIC_ID_SEGMENT_PATTERN.test(segment)
    ) {
      normalizedSegments.push(":id");
      continue;
    }

    normalizedSegments.push(segment);
  }

  const normalizedPath = `/${normalizedSegments.join("/")}`;
  setNormalizedPathCache(pathname, normalizedPath);
  return normalizedPath;
}

function setNormalizedPathCache(pathname: string, normalizedPath: string): void {
  if (normalizedPathCache.size >= NORMALIZED_PATH_CACHE_MAX_SIZE) {
    const oldestPath = normalizedPathCache.keys().next().value;
    if (oldestPath !== undefined) {
      normalizedPathCache.delete(oldestPath);
    }
  }

  normalizedPathCache.set(pathname, normalizedPath);
}

export async function emitLifecycleWideEvent(
  operationName: string,
  outcome: "success" | "error",
  config: ServerConfig,
): Promise<void> {
  await runWebWideEventContext(async () => {
    widelog.setFields({
      duration_ms: 0,
      operation: {
        name: operationName,
        type: "lifecycle",
      },
      outcome,
      request: {
        id: crypto.randomUUID(),
      },
      server: {
        environment: config.environment,
        port: config.serverPort,
      },
      status_code: outcome === "success" ? 200 : 500,
    });
    widelog.flush();
  });
}

export async function handleWithWideLogging(
  request: Request,
  config: ServerConfig,
  handleRequest: (request: Request) => Promise<Response>,
): Promise<Response> {
  return runWebWideEventContext(async () => {
    const requestUrl = new URL(request.url);
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

    const normalizedOperationPath = normalizeOperationPath(requestUrl.pathname);

    widelog.setFields({
      http: {
        method: request.method,
        path: requestUrl.pathname,
      },
      operation: {
        name: `${request.method} ${normalizedOperationPath}`,
        type: "http",
      },
      request: {
        id: requestId,
      },
      server: {
        environment: config.environment,
        port: config.serverPort,
      },
    });

    const userAgent = request.headers.get("user-agent");
    if (userAgent) {
      widelog.set("http.user_agent", userAgent);
    }

    try {
      return await widelog.time.measure("duration_ms", async () => {
        try {
          const response = await handleRequest(request);
          widelog.set("status_code", response.status);
          if (response.status >= 500) {
            widelog.set("outcome", "error");
          } else {
            widelog.set("outcome", "success");
          }
          return response;
        } catch (error) {
          if (isAbortError(error)) {
            widelog.set("status_code", 499);
            widelog.set("outcome", "cancelled");
            return new Response(null, { status: 499, statusText: "Client Closed Request" });
          }

          widelog.set("status_code", 500);
          widelog.set("outcome", "error");
          widelog.errorFields(error, { includeStack: false });
          return new Response("Internal Server Error", { status: 500 });
        }
      });
    } finally {
      widelog.flush();
    }
  });
}

export { destroyWideLogger, normalizeOperationPath };
