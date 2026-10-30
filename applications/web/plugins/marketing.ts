import { resolve } from "node:path";
import type { Plugin } from "vite";
import { CONTENT_DIRECTORIES } from "../src/lib/content-paths";
import { processMarketingDirectory } from "../src/lib/marketing-content";

const VIRTUAL_MODULE_ID = "virtual:marketing-copy";

export function marketingPlugin(): Plugin {
  const resolvedId = `\0${VIRTUAL_MODULE_ID}`;
  let contentDir: string;

  return {
    name: "keeper-marketing",

    configResolved(config) {
      contentDir = resolve(config.root, CONTENT_DIRECTORIES.marketing);
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return resolvedId;
    },

    load(id) {
      if (id !== resolvedId) return;

      const copy = processMarketingDirectory(contentDir);
      return `export const marketingCopy = ${JSON.stringify(copy)};`;
    },

    handleHotUpdate({ file, server }) {
      if (file.startsWith(contentDir)) {
        const module = server.moduleGraph.getModuleById(resolvedId);
        if (module) {
          server.moduleGraph.invalidateModule(module);
          return [module];
        }
      }
    },
  };
}
