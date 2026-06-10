import arkenv from "arkenv";

const schema = {
  API_PORT: "number",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  FEEDBACK_EMAIL: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  MCP_PUBLIC_URL: "string.url?",
  PASSKEY_ORIGIN: "string?",
  PASSKEY_RP_ID: "string?",
  PASSKEY_RP_NAME: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  POLAR_WEBHOOK_SECRET: "string?",
  REDIS_URL: "string.url",
  RESEND_API_KEY: "string?",
  PRIVATE_RESOLUTION_WHITELIST: "string?",
  BLOCK_PRIVATE_RESOLUTION: "boolean?",
  TRUSTED_ORIGINS: "string?",
  WEBSOCKET_URL: "string.url?",
} as const;

export { schema };
export default arkenv(schema);
