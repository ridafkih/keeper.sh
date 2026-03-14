import { randomBytes, createHash } from "crypto";

const TOKEN_PREFIX = "kpr_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;

const generateApiToken = (): string => {
  const bytes = randomBytes(TOKEN_BYTES);
  return TOKEN_PREFIX + bytes.toString("hex");
};

const hashApiToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

const extractTokenPrefix = (token: string): string => {
  return token.slice(0, DISPLAY_PREFIX_LENGTH);
};

const isApiToken = (value: string): boolean => {
  return value.startsWith(TOKEN_PREFIX);
};

export { generateApiToken, hashApiToken, extractTokenPrefix, isApiToken };
