import { join } from "node:path";

export default {
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: [
    join(__dirname, "src", "database", "schema.ts"),
    join(__dirname, "src", "database", "auth-schema.ts"),
  ],
};
