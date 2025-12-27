import env from "@keeper.sh/env/api";
import { database } from "@keeper.sh/database";
import {
  syncStatusTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { log } from "@keeper.sh/log";
import {
  createWebsocketHandler,
  startSubscriber,
  type BroadcastData,
  type Socket,
} from "@keeper.sh/broadcast";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { socketTokens } from "./utils/state";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";

const validateSocketToken = (token: string): string | null => {
  const entry = socketTokens.get(token);
  if (!entry) return null;
  clearTimeout(entry.timeout);
  socketTokens.delete(token);
  return entry.userId;
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

const server = Bun.serve<BroadcastData>({
  port: env.API_PORT,
  websocket: websocketHandler,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/socket") {
      const token = url.searchParams.get("token");
      const userId = token ? validateSocketToken(token) : null;

      if (!userId) {
        log.debug("socket upgrade unauthorized - invalid or missing token");
        return new Response("Unauthorized", { status: 401 });
      }

      log.debug({ userId }, "socket upgrade authorized");

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
  },
});

startSubscriber();

log.info({ port: server.port }, "server started");
