import env from "@keeper.sh/env/database/drizzle-config";
import { defineConfig } from "drizzle-kit";
import { join } from "node:path";

export default env.DATABASE_URL
  ? defineConfig({
      out: "./drizzle",
      schema: [
        join(__dirname, "src", "database", "schema.ts"),
        join(__dirname, "src", "database", "auth-schema.ts"),
      ],
      dialect: "postgresql",
      dbCredentials: {
        url: env.DATABASE_URL,
      },
    })
  : undefined;
