import arkenv from "arkenv";

const schema = {
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  CALENDAR_REDISCOVERY_ENABLED: "boolean?",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  PUSH_REDUCED_POLLING: "boolean?",
  REDIS_URL: "string.url",
  WEBHOOK_PUBLIC_URL: "string.url?",
  WORKER_JOB_QUEUE_ENABLED: "boolean?",
} as const;

export { schema };
export default arkenv(schema);
