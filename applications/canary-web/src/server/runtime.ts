import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { clientDistDirectory, serverDistEntry, sourceTemplatePath } from "./paths";
import { proxyRequest, readStaticFile } from "./proxy/http";
import type { Runtime, ServerConfig } from "./types";

interface EntryServerModule {
  render: (request: Request) => Promise<Response>;
}

function isEntryServerModule(value: unknown): value is EntryServerModule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const renderProperty = Reflect.get(value, "render");
  return typeof renderProperty === "function";
}

async function loadProductionRenderer(): Promise<EntryServerModule> {
  const moduleValue = await import(pathToFileURL(serverDistEntry).href);
  if (!isEntryServerModule(moduleValue)) {
    throw new Error("SSR entry module must export render(request).");
  }

  return moduleValue;
}

async function createProductionRuntime(): Promise<Runtime> {
  const template = await fs.readFile(`${clientDistDirectory}/index.html`, "utf-8");
  const renderer = await loadProductionRenderer();

  return {
    handleAssetRequest: async (request) => {
      const requestUrl = new URL(request.url);
      return readStaticFile(requestUrl.pathname);
    },
    renderApp: (request) => renderer.render(request),
    renderTemplate: async () => template,
  };
}

async function createViteDevServer(vitePort: number): Promise<ViteDevServer> {
  const viteServer = await createViteServer({
    appType: "custom",
    server: {
      hmr: {
        clientPort: vitePort,
        host: "localhost",
        port: vitePort,
      },
      port: vitePort,
      strictPort: true,
    },
  });

  await viteServer.listen();
  return viteServer;
}

async function loadDevelopmentRenderer(viteServer: ViteDevServer): Promise<EntryServerModule> {
  const moduleValue = await viteServer.ssrLoadModule("/src/server.tsx");
  if (!isEntryServerModule(moduleValue)) {
    throw new Error("Development SSR entry must export render(request).");
  }

  return moduleValue;
}

async function createDevelopmentRuntime(vitePort: number): Promise<Runtime> {
  const viteServer = await createViteDevServer(vitePort);
  const viteOrigin = `http://localhost:${vitePort}`;

  return {
    handleAssetRequest: (request) => proxyRequest(request, viteOrigin),
    renderApp: async (request) => {
      const renderer = await loadDevelopmentRenderer(viteServer);
      return renderer.render(request);
    },
    renderTemplate: async (requestPath) => {
      const template = await fs.readFile(sourceTemplatePath, "utf-8");
      return viteServer.transformIndexHtml(requestPath, template);
    },
    shutdown: () => viteServer.close(),
  };
}

export function createRuntime(config: ServerConfig): Promise<Runtime> {
  if (config.isProduction) {
    return createProductionRuntime();
  }

  return createDevelopmentRuntime(config.vitePort);
}
