import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    /*
     * Suites here boot an in-process PGlite and apply their schema in a setup
     * hook. That costs about a second on a developer machine, but CI runs every
     * workspace's vitest concurrently on a small shared runner, and under that
     * contention neither the boot nor a test body fits inside vitest's default
     * ten seconds.
     */
    hookTimeout: 60_000,
    include: ["./tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
