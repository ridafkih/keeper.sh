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
    env: {
      COMMIT_SHA: "test",
      ENV: "test",
      VERSION: "test",
    },
    globals: true,
    include: ["./tests/**/*.test.ts"],
  },
});
