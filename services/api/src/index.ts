import type { BroadcastData } from "@keeper.sh/broadcast";
import { entry } from "entrykit";
import { join } from "node:path";
import { withCors } from "./middleware/cors";
import { handleAuthRequest } from "./handlers/auth";
import { websocketHandler } from "./handlers/websocket";
import { validateSocketToken } from "./utils/state";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import { socketQuerySchema } from "./utils/request-query";
import { closeDatabase } from "@keeper.sh/database";
import { broadcastService, database, redis } from "./context";
import { destroy } from "./utils/logging";
import env from "./env";

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const router = new Bun.FileSystemRouter({
  dir: join(import.meta.dirname, "routes"),
  style: "nextjs",
});

await entry({
  main: async () => {
    const server = Bun.serve<BroadcastData>({
      port: env.API_PORT,
      websocket: websocketHandler,
      fetch: withCors(async (request) => {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/auth")) {
          return handleAuthRequest(url.pathname, request);
        }

        if (url.pathname === "/api/socket") {
          const token = url.searchParams.get("token");
          const query = Object.fromEntries(url.searchParams.entries());
          if (!token || !socketQuerySchema.allows(query)) {
            return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
          }

          const userId = await validateSocketToken(token);

          if (!userId) {
            return new Response("Unauthorized", { status: HTTP_UNAUTHORIZED });
          }

          const upgraded = server.upgrade(request, {
            data: { userId },
          });

          if (!upgraded) {
            return new Response("WebSocket upgrade failed", {
              status: HTTP_INTERNAL_SERVER_ERROR,
            });
          }

          return;
        }

        const match = router.match(request);

        if (!match) {
          return new Response("Not found", { status: HTTP_NOT_FOUND });
        }

        const module: unknown = await import(match.filePath);

        if (!isRouteModule(module)) {
          return new Response("Internal server error", {
            status: HTTP_INTERNAL_SERVER_ERROR,
          });
        }

        if (!isHttpMethod(request.method)) {
          return new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED });
        }

        const handler = module[request.method];

        if (!handler) {
          return new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED });
        }

        return handler(request, match.params, match.name);
      }),
    });

    await broadcastService.startSubscriber();

    return async () => {
      await destroy();
      server.stop();
      closeDatabase(database);
      redis.disconnect();
    };
  },
  name: "api",
});
