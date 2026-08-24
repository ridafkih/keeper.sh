export default {
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: [
    "./src/database/schema.ts",
    "./src/database/auth-schema.ts",
  ],
};
