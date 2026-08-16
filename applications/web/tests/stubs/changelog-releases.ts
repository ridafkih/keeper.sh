import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processChangelogDirectory } from "../../src/lib/changelog-content";

/**
 * Stands in for the `virtual:changelog-releases` module the Vite plugin builds.
 * Vitest does not run the plugin, so it reads the same folders the plugin reads:
 * the tests then assert against the real content rather than a fixture.
 */
export const changelogReleases = processChangelogDirectory(
  resolve(fileURLToPath(import.meta.url), "../../../seo/changelog"),
);
