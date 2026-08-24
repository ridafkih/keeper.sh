import { randomBytes, createHash } from "node:crypto";

const TOKEN_PREFIX = "kpr_";
const TOKEN_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;

const generateApiToken = (): string => TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("hex");

const hashApiToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const extractTokenPrefix = (token: string): string => token.slice(0, DISPLAY_PREFIX_LENGTH);

const isApiToken = (value: string): boolean => value.startsWith(TOKEN_PREFIX);

export { generateApiToken, hashApiToken, extractTokenPrefix, isApiToken };
