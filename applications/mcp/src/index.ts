import { entry } from "entrykit";
import { join } from "node:path";
import { tryLoadMcpEnv } from "@keeper.sh/env/mcp";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import { emitWideEvent, reportError, shutdownLogging } from "./utils/logging";

const env = tryLoadMcpEnv();

if (!env) {
  process.exit(0);
}

const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const router = new Bun.FileSystemRouter({
  dir: join(import.meta.dirname, "routes"),
  style: "nextjs",
});

await entry({
  main: async () => {
    try {
      const server = Bun.serve({
        port: env.MCP_PORT,
        fetch: async (request) => {
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

          return handler(request);
        },
      });

      await emitWideEvent({
        "operation.name": "mcp:start",
        "operation.type": "lifecycle",
        "service.name": "mcp",
        port: env.MCP_PORT,
      });

      return () => {
        server.stop();
        shutdownLogging().catch((error) => {
          reportError(error, {
            "operation.name": "mcp:shutdown",
            "operation.type": "lifecycle",
          });
        });
      };
    } catch (error) {
      reportError(error, {
        "operation.name": "mcp:start",
        "operation.type": "lifecycle",
      });
      throw error;
    }
  },
  name: "mcp",
});
