import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { processMarketingDirectory } from "../../src/lib/marketing-content";

/**
 * Stands in for the `virtual:marketing-copy` module the Vite plugin builds.
 * Vitest does not run the plugin, so it reads the same folder the plugin reads:
 * the tests then assert against the real copy rather than a fixture.
 */
export const marketingCopy = processMarketingDirectory(
  resolve(fileURLToPath(import.meta.url), "../../../seo/marketing"),
);
