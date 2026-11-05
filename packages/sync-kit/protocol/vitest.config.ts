import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    hookTimeout: 30_000,
    include: ["./tests/**/*.test.ts"],
    testTimeout: 30_000,
    typecheck: {
      enabled: true,
      include: ["./tests/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
