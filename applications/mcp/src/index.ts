import { entry } from "entrykit";
import { join } from "node:path";
import { tryLoadMcpEnv } from "@keeper.sh/env/mcp";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";
import { destroyWideLogger, widelog } from "./utils/logging";

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
  main: () => widelog.context(() => {
      widelog.set("operation.name", "mcp:start");
      widelog.set("operation.type", "lifecycle");
      widelog.set("service.name", "mcp");
      widelog.set("port", env.MCP_PORT);

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

        widelog.set("outcome", "success");

        return () => {
          server.stop();
          destroyWideLogger();
        };
      } catch (error) {
        widelog.set("outcome", "error");
        widelog.errorFields(error);
        throw error;
      } finally {
        widelog.flush();
      }
    }),
  name: "mcp",
});
