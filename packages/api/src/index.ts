import type { BroadcastData } from "@keeper.sh/broadcast";
import { entry } from "@keeper.sh/entry-point";
import { schema } from "@keeper.sh/env/api";
import { join } from "node:path";
import { withCors } from "./middleware/cors";
import { handleAuthRequest } from "./handlers/auth";
import { websocketHandler } from "./handlers/websocket";
import { validateSocketToken } from "./utils/state";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import { broadcastService } from "./context";

const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const router = new Bun.FileSystemRouter({
  dir: join(import.meta.dirname, "routes"),
  style: "nextjs",
});

entry("api")
  .env(schema)
  .run(async ({ env, context }) => {
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
      }),
    });

    await broadcastService.startSubscriber();

    context.set("port", env.API_PORT);
  });
