import arkenv from "arkenv";

export default arkenv({
  DATABASE_URL: "string.url",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  COMMERCIAL_MODE: "boolean?",
  USERNAME_ONLY_MODE: "boolean?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined",
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
