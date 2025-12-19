import arkenv from "arkenv";

export default arkenv({
  DATABASE_URL: "string.url",
  BETTER_AUTH_SECRET: "string",
  BETTER_AUTH_URL: "string.url",
  NO_EMAIL_REQUIRED: "boolean?",
  POLAR_ACCESS_TOKEN: "string?",
  POLAR_MODE: "'sandbox' | 'production' | undefined",
});
