import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(fileURLToPath(import.meta.url), "../src"),
    },
  },
  test: {
    globals: true,
    /*
     * Suites here boot an in-process PGlite and apply their schema in a setup
     * hook. That costs well under a second on a developer machine, but CI runs
     * every workspace's vitest concurrently on a two-core runner alongside a
     * Postgres service container, and the default ten seconds is not enough
     * headroom for it there.
     */
    hookTimeout: 60_000,
    include: ["./tests/**/*.test.ts", "./tests/**/*.test.tsx"],
    testTimeout: 60_000,
  },
});
