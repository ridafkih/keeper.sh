import arkenv from "arkenv";

export default arkenv({
  API_PORT: "number",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  DATABASE_URL: "string.url",
  ENCRYPTION_KEY: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  PASSKEY_ORIGIN: "string?",
  PASSKEY_RP_ID: "string?",
  PASSKEY_RP_NAME: "string?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  POLAR_WEBHOOK_SECRET: "string?",
  REDIS_URL: "string.url",
  RESEND_API_KEY: "string?",
  TRUSTED_ORIGINS: "string?",
  WEBSOCKET_URL: "string.url?",
});
