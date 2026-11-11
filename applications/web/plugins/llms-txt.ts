import { resolve } from "node:path";
import type { Plugin } from "vite";
import { SEO_CONTENT_ROOT } from "../src/lib/content-paths";
import { isLlmsTextFileName, readLlmsTextFile, readLlmsTextFiles } from "../src/lib/llms-text-files";

const CONTENT_TYPE = "text/plain; charset=utf-8";

export function llmsTxtPlugin(): Plugin {
  let contentRoot: string;

  return {
    name: "keeper-llms-txt",

    configResolved(config) {
      contentRoot = resolve(config.root, SEO_CONTENT_ROOT);
    },

    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const fileName = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
        if (!isLlmsTextFileName(fileName)) return next();

        const { content } = readLlmsTextFile(contentRoot, fileName);
        if (content === null) return next();

        response.setHeader("content-type", CONTENT_TYPE);
        response.end(content);
      });
    },

    generateBundle() {
      for (const { content, fileName } of readLlmsTextFiles(contentRoot)) {
        if (content === null) {
          this.warn(`${fileName} missing from ${contentRoot}; fetch the seo submodule to publish it.`);
          continue;
        }

        this.emitFile({ type: "asset", fileName, source: content });
      }
    },
  };
}
