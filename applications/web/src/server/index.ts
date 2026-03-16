import { entry } from "entrykit";
import { createServerConfig, envSchema } from "./config";
import { handleApplicationRequest } from "./http-handler";
import { websocketProxyHandlers, upgradeSocketProxy } from "./proxy/websocket";
import { createRuntime } from "./runtime";
import type { SocketProxyData } from "./types";
import { checkMigrationStatus } from "./migration-check";

checkMigrationStatus();

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

        return handleApplicationRequest(request, runtime, config);
      },
      port: config.serverPort,
      websocket: websocketProxyHandlers,
    });

    return async () => {
      server.stop(true);
      if (runtime.shutdown) {
        await runtime.shutdown();
      }
    };
  },
});
