import { defineConfig } from "vitest/config";

const MIGRATION_TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: {
    fileParallelism: false,
    globals: true,
    hookTimeout: MIGRATION_TEST_TIMEOUT_MS,
    include: ["./tests/migrations/**/*.test.ts"],
    testTimeout: MIGRATION_TEST_TIMEOUT_MS,
  },
});
