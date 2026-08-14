import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 60_000,
    include: ["./tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
