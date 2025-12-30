import arkenv from "arkenv";

export default arkenv({
  API_PORT: "number",
  DATABASE_URL: "string.url",
  REDIS_URL: "string.url",
  WEBSOCKET_URL: "string.url?",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined?",
  POLAR_WEBHOOK_SECRET: "string?",
  GOOGLE_CLIENT_ID: "string?",
  GOOGLE_CLIENT_SECRET: "string?",
  MICROSOFT_CLIENT_ID: "string?",
  MICROSOFT_CLIENT_SECRET: "string?",
  RESEND_API_KEY: "string?",
  PASSKEY_RP_ID: "string?",
  PASSKEY_RP_NAME: "string?",
  PASSKEY_ORIGIN: "string?",
  ENCRYPTION_KEY: "string?",
});
