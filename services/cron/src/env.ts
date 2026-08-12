import arkenv from "arkenv";
import { checkEncryptionKeyConfigured } from "@keeper.sh/database";

const schema = {
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  REDIS_URL: "string.url",
  WORKER_JOB_QUEUE_ENABLED: "boolean?",
} as const;

checkEncryptionKeyConfigured(process.env.ENCRYPTION_KEY);

export { schema };
export default arkenv(schema);
