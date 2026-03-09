import { entry } from "entrykit";
import { createServerConfig, envSchema } from "./config";
import { handleApplicationRequest } from "./http-handler";
import { destroyWideLogger, emitLifecycleWideEvent, handleWithWideLogging } from "./logging";
import { websocketProxyHandlers, upgradeSocketProxy } from "./proxy/websocket";
import { createRuntime } from "./runtime";
import type { SocketProxyData } from "./types";

await entry({
  env: envSchema,
  name: "canary-web",
  main: async ({ env }) => {
    const config = createServerConfig(env);
    const runtime = await createRuntime(config);

    const server = Bun.serve<SocketProxyData>({
      fetch: (request, httpServer) => {
        const upgraded = upgradeSocketProxy(request, httpServer, config);
        if (upgraded) {
          return;
        }

        return handleWithWideLogging(request, config, (currentRequest) =>
          handleApplicationRequest(currentRequest, runtime, config),
        );
      },
      port: config.serverPort,
      websocket: websocketProxyHandlers,
    });

    await emitLifecycleWideEvent("ssr:start", "success", config);

    return async () => {
      server.stop(true);
      if (runtime.shutdown) {
        await runtime.shutdown();
      }
      await emitLifecycleWideEvent("ssr:shutdown", "success", config);
      await destroyWideLogger();
    };
  },
});
