import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    deps: {
      interopDefault: false,
    },
    globals: true,
    pool: "forks",
    include: ["./tests/**/*.test.ts"],
  },
});
