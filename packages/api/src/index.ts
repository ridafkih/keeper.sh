import env from "@keeper.sh/env/api";
import {
  syncStatusTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import {
  log,
  WideEvent,
  runWithWideEvent,
  emitWideEvent,
  type WideEventFields,
} from "@keeper.sh/log";
import {
  createWebsocketHandler,
  type BroadcastData,
  type Socket,
} from "@keeper.sh/broadcast";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { socketTokens } from "./utils/state";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import {
  database,
  broadcastService,
  auth,
  trustedOrigins,
  baseUrl,
} from "./context";

const validateSocketToken = (token: string): string | null => {
  const entry = socketTokens.get(token);
  if (!entry) return null;
  clearTimeout(entry.timeout);
  socketTokens.delete(token);
  return entry.userId;
};

const isNullSession = (body: unknown): boolean => {
  if (body === null) return true;
  if (typeof body !== "object") return false;
  if (!("session" in body)) return false;
  return body.session === null;
};

const clearSessionCookies = (response: Response): Response => {
  const headers = new Headers(response.headers);
  const expiredCookie = "Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
  headers.append("Set-Cookie", `better-auth.session_token=; ${expiredCookie}`);
  headers.append("Set-Cookie", `better-auth.session_data=; ${expiredCookie}`);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

type FetchHandler = (request: Request) => Promise<Response | undefined>;

const withCors = (handler: FetchHandler): FetchHandler => {
  const allowedOrigins = [...trustedOrigins];
  if (baseUrl) allowedOrigins.push(baseUrl);

  const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) return false;
    if (allowedOrigins.length === 0) return false;
    return allowedOrigins.includes(origin);
  };

  const corsHeaders = (origin: string) => ({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",
  });

  return async (request) => {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 204 });
      if (!isOriginAllowed(origin)) return new Response(null, { status: 403 });

      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Max-Age": "86400",
        },
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
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
};

const extractAuthContext = (
  request: Request,
  pathname: string
): Partial<WideEventFields> => ({
  operationType: "auth",
  operationName: `${request.method} ${pathname}`,
  httpMethod: request.method,
  httpPath: pathname,
  httpUserAgent: request.headers.get("user-agent") ?? undefined,
  httpOrigin: request.headers.get("origin") ?? undefined,
});

const handleAuthResponseStatus = (
  event: WideEvent,
  response: Response
): void => {
  event.set({ httpStatusCode: response.status });
  if (response.status >= 400) {
    event.set({
      error: true,
      errorType: "AuthError",
      errorMessage: `HTTP ${response.status}`,
    });
  }
};

const processAuthResponse = async (
  pathname: string,
  response: Response
): Promise<Response> => {
  if (pathname !== "/api/auth/get-session") {
    return response;
  }

  const body = await response.clone().json();

  if (!isNullSession(body)) {
    return response;
  }

  return clearSessionCookies(response);
};

const handleAuthRequest = async (
  pathname: string,
  request: Request
): Promise<Response> => {
  const event = new WideEvent("api");
  event.set(extractAuthContext(request, pathname));

  return runWithWideEvent(event, async () => {
    try {
      const response = await auth.handler(request);
      handleAuthResponseStatus(event, response);
      return processAuthResponse(pathname, response);
    } catch (error) {
      event.setError(error);
      event.set({ httpStatusCode: 500 });
      throw error;
    } finally {
      emitWideEvent(event.finalize());
    }
  });
};

const sendInitialSyncStatus = async (userId: string, socket: Socket) => {
  const statuses = await database
    .select({
      destinationId: syncStatusTable.destinationId,
      localEventCount: syncStatusTable.localEventCount,
      remoteEventCount: syncStatusTable.remoteEventCount,
      lastSyncedAt: syncStatusTable.lastSyncedAt,
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
        event: "sync:status",
        data: {
          destinationId: status.destinationId,
          status: "idle",
          localEventCount: status.localEventCount,
          remoteEventCount: status.remoteEventCount,
          lastSyncedAt: status.lastSyncedAt?.toISOString(),
          inSync: status.localEventCount === status.remoteEventCount,
        },
      }),
    );
  }
};

const websocketHandler = createWebsocketHandler({
  onConnect: sendInitialSyncStatus,
});

const router = new Bun.FileSystemRouter({
  style: "nextjs",
  dir: join(import.meta.dirname, "routes"),
});

const handleRequest = async (
  request: Request,
): Promise<Response | undefined> => {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/auth")) {
    return handleAuthRequest(url.pathname, request);
  }

  if (url.pathname === "/api/socket") {
    const token = url.searchParams.get("token");
    const userId = token ? validateSocketToken(token) : null;

    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const upgraded = server.upgrade(request, {
      data: { userId },
    });

    if (!upgraded) {
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return undefined;
  }

  const match = router.match(request);

  if (!match) {
    return new Response("Not found", { status: 404 });
  }

  const module: unknown = await import(match.filePath);

  if (!isRouteModule(module)) {
    return new Response("Internal server error", { status: 500 });
  }

  if (!isHttpMethod(request.method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const handler = module[request.method];

  if (!handler) {
    return new Response("Method not allowed", { status: 405 });
  }

  return handler(request, match.params);
};

const server = Bun.serve<BroadcastData>({
  port: env.API_PORT,
  websocket: websocketHandler,
  fetch: withCors(handleRequest),
});

broadcastService.startSubscriber();

log.info({ port: env.API_PORT }, "server started");
