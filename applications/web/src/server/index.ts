import { entry } from "entrykit";
import { createServerConfig, envSchema } from "./config";
import { handleApplicationRequest } from "./http-handler";
import { websocketProxyHandlers, upgradeSocketProxy } from "./proxy/websocket";
import { createRuntime } from "./runtime";
import type { SocketProxyData } from "./types";
import { checkMigrationStatus } from "./migration-check";
import { context, destroy, widelog } from "./logging";

checkMigrationStatus();

const resolveOutcome = (statusCode: number): "success" | "error" => {
  if (statusCode >= 400) {
    return "error";
  }
  return "success";
};

await entry({
  env: envSchema,
  name: "web",
  main: async ({ env }) => {
    const config = createServerConfig(env);
    const runtime = await createRuntime(config);

    const server = Bun.serve<SocketProxyData>({
      fetch: (request, httpServer) => {
        const upgraded = upgradeSocketProxy(request, httpServer, config);
        if (upgraded) {
          return;
        }

        return context(async () => {
          const url = new URL(request.url);
          const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

          widelog.set("operation.name", `${request.method} ${url.pathname}`);
          widelog.set("operation.type", "http");
          widelog.set("request.id", requestId);
          widelog.set("http.method", request.method);
          widelog.set("http.path", url.pathname);

          const userAgent = request.headers.get("user-agent");
          if (userAgent) {
            widelog.set("http.user_agent", userAgent);
          }

          try {
            return await widelog.time.measure("duration_ms", async () => {
              const response = await handleApplicationRequest(request, runtime, config);
              widelog.set("status_code", response.status);
              widelog.set("outcome", resolveOutcome(response.status));
              return response;
            });
          } catch (error) {
            widelog.set("status_code", 500);
            widelog.set("outcome", "error");
            widelog.errorFields(error, { slug: "unclassified" });
            throw error;
          } finally {
            widelog.flush();
          }
        });
      },
      port: config.serverPort,
      websocket: websocketProxyHandlers,
    });

    return async () => {
      server.stop(true);
      if (runtime.shutdown) {
        await runtime.shutdown();
      }
      await destroy();
    };
  },
});
