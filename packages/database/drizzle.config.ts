import type { Config } from "drizzle-kit";
import { defineConfig } from "drizzle-kit";
import { join } from "node:path";

export default ((): Config | void => {
  if (process.env.DATABASE_URL) {
    return defineConfig({
      dbCredentials: {
        url: process.env.DATABASE_URL,
      },
      dialect: "postgresql",
      out: "./drizzle",
      schema: [
        join(__dirname, "src", "database", "schema.ts"),
        join(__dirname, "src", "database", "auth-schema.ts"),
      ],
    });
  }
})();
