import arkenv from "arkenv";

const schema = {
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  POLAR_PRO_PRODUCT_IDS: "string?",
  POLAR_UNLIMITED_PRODUCT_IDS: "string?",
  REDIS_URL: "string.url",
  WORKER_JOB_QUEUE_ENABLED: "boolean?",
} as const;

export { schema };
export default arkenv(schema);
