import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["./tests/migrations/**"],
    /*
     * The KEEPER_TEST_DATABASE_URL suites connect to a real Postgres and drive
     * pool saturation against it. CI runs every workspace's vitest concurrently
     * on a two-core runner sharing one Postgres service container, so neither
     * setup nor a test body fits inside the default ten seconds there.
     */
    hookTimeout: 60_000,
    include: ["./tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
