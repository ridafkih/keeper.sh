import { entry } from "entrykit";
import { auth, env, handleMcpRequest } from "./context";

const CORS_ALLOW_HEADERS = [
  "Authorization",
  "Content-Type",
  "Accept",
  "MCP-Protocol-Version",
  "Last-Event-ID",
].join(", ");

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

const createOptionsResponse = (): Response =>
  withCorsHeaders(new Response(null, { status: 204 }));

const createJsonResponse = (body: unknown, status = 200): Response =>
  withCorsHeaders(
    Response.json(body, {
      status,
    }),
  );

await entry({
  main: async () => {
    const server = Bun.serve({
      port: env.MCP_PORT,
      fetch: async (request) => {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
          return createOptionsResponse();
        }

        if (url.pathname === "/health") {
          return createJsonResponse({ service: "mcp", status: "ok" });
        }

        if (url.pathname === "/.well-known/oauth-protected-resource") {
          const metadata = await auth.api.getMCPProtectedResource();
          return createJsonResponse(metadata);
        }

        if (url.pathname === "/.well-known/oauth-authorization-server") {
          const metadata = await auth.api.getMcpOAuthConfig();
          return createJsonResponse(metadata);
        }

        if (url.pathname === "/mcp") {
          const response = await handleMcpRequest(request);
          return withCorsHeaders(response);
        }

        return withCorsHeaders(new Response("Not found", { status: 404 }));
      },
    });

    return () => {
      server.stop();
    };
  },
  name: "mcp",
});
