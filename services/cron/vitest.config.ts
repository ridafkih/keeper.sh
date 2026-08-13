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
     * Several suites here shell out to a real `bun` subprocess or build a
     * temporary workspace on disk. CI runs every workspace's vitest
     * concurrently on a two-core runner, where a process spawn does not fit
     * inside vitest's five-second default.
     */
    hookTimeout: 60_000,
    include: ["./tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
