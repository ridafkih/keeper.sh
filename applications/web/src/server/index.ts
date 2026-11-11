import { HTTP_IDLE_TIMEOUT_SECONDS } from "@keeper.sh/constants";
import { startTracing, traceIncomingRequest } from "@keeper.sh/otelemetry/tracing";
import { entry } from "entrykit";
import { getServerPublicRuntimeConfig } from "@/lib/runtime-config";
import { createServerConfig, envSchema } from "./config";
import { handleApplicationRequest } from "./http-handler";
import { websocketProxyHandlers, upgradeSocketProxy } from "./proxy/websocket";
import { createRuntime } from "./runtime";
import type { SocketProxyData } from "./types";
import { checkMigrationStatus } from "./migration-check";
import { context, destroy, widelog } from "./logging";
import { resolveTrafficSource } from "./traffic-source";

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
    const config = createServerConfig(
      env,
      getServerPublicRuntimeConfig({ environment: process.env }),
    );
    const tracing = startTracing({
      serviceName: "keeper-web",
      propagateToOrigins: [config.apiProxyOrigin, config.mcpProxyOrigin].filter((origin) => origin !== null),
      environment: process.env,
    });
    const runtime = await createRuntime(config);

    const server = Bun.serve<SocketProxyData>({
      idleTimeout: HTTP_IDLE_TIMEOUT_SECONDS,
      fetch: (request, httpServer) => {
        const upgraded = upgradeSocketProxy(request, httpServer, config);
        if (upgraded) {
          return;
        }

        return traceIncomingRequest(request, { trustIncomingTraceContext: false }, () => context(async () => {
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

          const trafficSource = resolveTrafficSource(request, url);
          if (trafficSource.referrerOrigin) {
            widelog.set("http.referrer_origin", trafficSource.referrerOrigin);
          }
          widelog.set("traffic.has_utm", trafficSource.hasUtmParameters);
          widelog.set("traffic.has_gclid", trafficSource.hasGoogleClickId);

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
        }));
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
      await tracing.shutdown();
    };
  },
});
