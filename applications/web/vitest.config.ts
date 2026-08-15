import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(fileURLToPath(import.meta.url), "../src"),
      "virtual:compare-pages": resolve(fileURLToPath(import.meta.url), "../tests/stubs/virtual-content.ts"),
      "virtual:docs-pages": resolve(fileURLToPath(import.meta.url), "../tests/stubs/virtual-content.ts"),
      "virtual:guides-pages": resolve(fileURLToPath(import.meta.url), "../tests/stubs/virtual-content.ts"),
      "virtual:recipes-pages": resolve(fileURLToPath(import.meta.url), "../tests/stubs/virtual-content.ts"),
    },
  },
  test: {
    globals: true,
    include: ["./tests/**/*.test.ts", "./tests/**/*.test.tsx"],
    onConsoleLog: (log) => (log.startsWith("[subscription]") ? false : undefined),
  },
});
