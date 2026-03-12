import { entry } from "entrykit";
import { join } from "node:path";
import { tryLoadMcpEnv } from "@keeper.sh/env/mcp";
import { isHttpMethod, isRouteModule } from "./utils/route-handler";

const env = tryLoadMcpEnv();

if (!env) {
  process.exit(0);
}

const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Accept, MCP-Protocol-Version, Last-Event-ID";
const CORS_ALLOW_METHODS = "GET, POST, DELETE, OPTIONS";
const CORS_EXPOSE_HEADERS = "WWW-Authenticate, MCP-Session-Id";

const withCorsHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

const router = new Bun.FileSystemRouter({
  dir: join(import.meta.dirname, "routes"),
  style: "nextjs",
});

await entry({
  main: () => {
    const server = Bun.serve({
      port: env.MCP_PORT,
      fetch: async (request) => {
        if (request.method === "OPTIONS") {
          return withCorsHeaders(new Response(null, { status: 204 }));
        }

        const match = router.match(request);

        if (!match) {
          return withCorsHeaders(new Response("Not found", { status: HTTP_NOT_FOUND }));
        }

        const module: unknown = await import(match.filePath);

        if (!isRouteModule(module)) {
          return withCorsHeaders(
            new Response("Internal server error", { status: HTTP_INTERNAL_SERVER_ERROR }),
          );
        }

        if (!isHttpMethod(request.method)) {
          return withCorsHeaders(
            new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED }),
          );
        }

        const handler = module[request.method];

        if (!handler) {
          return withCorsHeaders(
            new Response("Method not allowed", { status: HTTP_METHOD_NOT_ALLOWED }),
          );
        }

        const response = await handler(request);
        return withCorsHeaders(response);
      },
    });

    return () => {
      server.stop();
    };
  },
  name: "mcp",
});
