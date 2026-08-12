import arkenv from "arkenv";
import { checkEncryptionKeyConfigured } from "@keeper.sh/database";

const schema = {
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  REDIS_URL: "string.url",
  WORKER_CONCURRENCY: "string?",
} as const;

checkEncryptionKeyConfigured(process.env.ENCRYPTION_KEY);

export { schema };
export default arkenv(schema);
