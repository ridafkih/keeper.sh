import type { MaybePromise } from "bun";
import env from "@keeper.sh/env/api";
import { syncStatusTable, calendarDestinationsTable } from "@keeper.sh/database/schema";

import { log, WideEvent, runWithWideEvent, emitWideEvent } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";
import { createWebsocketHandler } from "@keeper.sh/broadcast";
import type { BroadcastData, Socket } from "@keeper.sh/broadcast";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { socketTokens } from "./utils/state";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import { database, broadcastService, auth, trustedOrigins, baseUrl } from "./context";

const CORS_MAX_AGE_SECONDS = 86_400;
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_ERROR_THRESHOLD = 400;
const EMPTY_ORIGINS_COUNT = 0;

const validateSocketToken = (token: string): string | null => {
  const entry = socketTokens.get(token);
  if (!entry) {
    return null;
  }
  clearTimeout(entry.timeout);
  socketTokens.delete(token);
  return entry.userId;
};

const isNullSession = (body: unknown): body is null | { session: null } => {
  if (body === null) {
    return true;
  }
  if (typeof body !== "object") {
    return false;
  }
  if (!("session" in body)) {
    return false;
  }
  return body.session === null;
};

const clearSessionCookies = (response: Response): Response => {
  const headers = new Headers(response.headers);
  const expiredCookie = "Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
  headers.append("Set-Cookie", `better-auth.session_token=; ${expiredCookie}`);
  headers.append("Set-Cookie", `better-auth.session_data=; ${expiredCookie}`);
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

type FetchHandler = (request: Request) => MaybePromise<Response | undefined>;

const corsHeaders = (origin: string): Record<string, string> => ({
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": origin,
});

const withCors = (handler: FetchHandler): FetchHandler => {
  const allowedOrigins = [...trustedOrigins];
  if (baseUrl) {
    allowedOrigins.push(baseUrl);
  }

  const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) {
      return false;
    }
    if (allowedOrigins.length === EMPTY_ORIGINS_COUNT) {
      return false;
    }
    return allowedOrigins.includes(origin);
  };

  return async (request): Promise<Response | undefined> => {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (!origin) {
        return new Response(null, { status: HTTP_NO_CONTENT });
      }
      if (!isOriginAllowed(origin)) {
        return new Response(null, { status: HTTP_FORBIDDEN });
      }

      return new Response(null, {
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
        },
        status: HTTP_NO_CONTENT,
      });
    }

    const response = await handler(request);

    if (!response || !origin || !isOriginAllowed(origin)) {
      return response;
    }

    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
};

const extractAuthContext = (request: Request, pathname: string): Partial<WideEventFields> => ({
  httpMethod: request.method,
  httpOrigin: request.headers.get("origin"),
  httpPath: pathname,
  httpUserAgent: request.headers.get("user-agent"),
  operationName: `${request.method} ${pathname}`,
  operationType: "auth",
});

const handleAuthResponseStatus = (event: WideEvent, response: Response): void => {
  event.set({ httpStatusCode: response.status });
  if (response.status >= HTTP_ERROR_THRESHOLD) {
    event.set({
      error: true,
      errorMessage: `HTTP ${response.status}`,
      errorType: "AuthError",
    });
  }
};

const processAuthResponse = async (pathname: string, response: Response): Promise<Response> => {
  if (pathname !== "/api/auth/get-session") {
    return response;
  }

  const body = await response.clone().json();

  if (!isNullSession(body)) {
    return response;
  }

  return clearSessionCookies(response);
};

const handleAuthRequest = (pathname: string, request: Request): MaybePromise<Response> => {
  const event = new WideEvent("api");
  event.set(extractAuthContext(request, pathname));

  return runWithWideEvent(event, async () => {
    try {
      const response = await auth.handler(request);
      handleAuthResponseStatus(event, response);
      return processAuthResponse(pathname, response);
    } catch (error) {
      event.setError(error);
      event.set({ httpStatusCode: HTTP_INTERNAL_SERVER_ERROR });
      throw error;
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

const sendInitialSyncStatus = async (userId: string, socket: Socket): Promise<void> => {
  const statuses = await database
    .select({
      destinationId: syncStatusTable.destinationId,
      lastSyncedAt: syncStatusTable.lastSyncedAt,
      localEventCount: syncStatusTable.localEventCount,
      remoteEventCount: syncStatusTable.remoteEventCount,
    })
    .from(syncStatusTable)
    .innerJoin(
      calendarDestinationsTable,
      eq(syncStatusTable.destinationId, calendarDestinationsTable.id),
    )
    .where(eq(calendarDestinationsTable.userId, userId));

  for (const status of statuses) {
    socket.send(
      JSON.stringify({
        data: {
          destinationId: status.destinationId,
          inSync: status.localEventCount === status.remoteEventCount,
          lastSyncedAt: status.lastSyncedAt?.toISOString(),
          localEventCount: status.localEventCount,
          remoteEventCount: status.remoteEventCount,
          status: "idle",
        },
        event: "sync:status",
      }),
    );
  }
};

const websocketHandler = createWebsocketHandler({
  onConnect: sendInitialSyncStatus,
});

const router = new Bun.FileSystemRouter({
  dir: join(import.meta.dirname, "routes"),
  style: "nextjs",
});

const handleRequest = async (request: Request): Promise<Response | undefined> => {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth")) {
    return handleAuthRequest(url.pathname, request);
  }

  if (url.pathname === "/api/socket") {
    const token = url.searchParams.get("token");
    const userId = token && validateSocketToken(token);

    if (!userId) {
      return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
    }

    const upgraded = server.upgrade(request, {
      data: { userId },
    });

    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: HTTP_INTERNAL_SERVER_ERROR });
    }

    return;
  }

  const match = router.match(request);

  if (!match) {
    return new Response("Not found", { status: HTTP_NOT_FOUND });
  }

  const module: unknown = await import(match.filePath);

  if (!isRouteModule(module)) {
    return new Response("Internal server error", { status: HTTP_INTERNAL_SERVER_ERROR });
  }

  if (!isHttpMethod(request.method)) {
    return new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED });
  }

  const handler = module[request.method];

  if (!handler) {
    return new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED });
  }

  return handler(request, match.params);
};

const server = Bun.serve<BroadcastData>({
  fetch: withCors(handleRequest),
  port: env.API_PORT,
  websocket: websocketHandler,
});

broadcastService.startSubscriber();

log.info({ port: env.API_PORT }, "server started");
