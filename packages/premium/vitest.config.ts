import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    deps: {
      interopDefault: false,
    },
    globals: true,
    include: ["./tests/**/*.test.ts"],
  },
});
