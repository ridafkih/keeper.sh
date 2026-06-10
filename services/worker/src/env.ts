import arkenv from "arkenv";

const schema = {
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  REDIS_URL: "string.url",
  WORKER_CONCURRENCY: "string?",
} as const;

export { schema };
export default arkenv(schema);
