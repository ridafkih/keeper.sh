import { randomBytes } from "node:crypto";

const FEED_TOKEN_PREFIX = "feed_";
const FEED_TOKEN_BYTES = 32;

const generateFeedToken = (): string =>
  FEED_TOKEN_PREFIX + randomBytes(FEED_TOKEN_BYTES).toString("hex");

export { generateFeedToken };
