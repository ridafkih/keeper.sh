import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { clientDistDirectory, serverDistEntry, sourceTemplatePath } from "./paths";
import { proxyRequest, readStaticFile } from "./proxy/http";
import { extractViteAssets } from "./vite-assets";
import type { ViteAssets } from "../lib/router-context";
import type { Runtime, ServerConfig } from "./types";

interface EntryServerModule {
  render: (request: Request, viteAssets: ViteAssets) => Promise<Response>;
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
    throw new Error("SSR entry module must export render(request, viteAssets).");
  }

  return moduleValue;
}

async function createProductionRuntime(): Promise<Runtime> {
  const template = await fs.readFile(`${clientDistDirectory}/index.html`, "utf-8");
  const viteAssets = extractViteAssets(template);
  const renderer = await loadProductionRenderer();

  return {
    handleAssetRequest: async (request) => {
      const requestUrl = new URL(request.url);
      return readStaticFile(requestUrl.pathname);
    },
    resolveViteAssets: async () => viteAssets,
    renderApp: (request, assets) => renderer.render(request, assets),
  };
}

async function createViteDevServerInstance(vitePort: number): Promise<ViteDevServer> {
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
    throw new Error("Development SSR entry must export render(request, viteAssets).");
  }

  return moduleValue;
}

async function createDevelopmentRuntime(vitePort: number): Promise<Runtime> {
  const viteServer = await createViteDevServerInstance(vitePort);
  const viteOrigin = `http://localhost:${vitePort}`;

  return {
    handleAssetRequest: (request) => proxyRequest(request, viteOrigin),
    resolveViteAssets: async (requestPath) => {
      const template = await fs.readFile(sourceTemplatePath, "utf-8");
      const transformed = await viteServer.transformIndexHtml(requestPath, template);
      return extractViteAssets(transformed);
    },
    renderApp: async (request, viteAssets) => {
      const renderer = await loadDevelopmentRenderer(viteServer);
      return renderer.render(request, viteAssets);
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
