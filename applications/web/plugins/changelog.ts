import { resolve } from "node:path";
import type { Plugin } from "vite";
import { CONTENT_DIRECTORIES } from "../src/lib/content-paths";
import { processChangelogDirectory } from "../src/lib/changelog-content";

/** Where the release folders live, relative to the Vite root. */
const CHANGELOG_DIRECTORY = CONTENT_DIRECTORIES.changelog;

const VIRTUAL_MODULE_ID = "virtual:changelog-releases";

export function changelogPlugin(): Plugin {
  const resolvedId = `\0${VIRTUAL_MODULE_ID}`;
  let contentDir: string;

  return {
    name: "keeper-changelog",

    configResolved(config) {
      contentDir = resolve(config.root, CHANGELOG_DIRECTORY);
    },

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) return resolvedId;
    },

    load(id) {
      if (id !== resolvedId) return;

      const releases = processChangelogDirectory(contentDir);
      return `export const changelogReleases = ${JSON.stringify(releases)};`;
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
