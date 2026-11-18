import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      COMMIT_SHA: "test",
      ENV: "test",
      VERSION: "test",
    },
    deps: {
      interopDefault: false,
    },
    globals: true,
    include: ["./tests/**/*.test.ts"],
  },
});
