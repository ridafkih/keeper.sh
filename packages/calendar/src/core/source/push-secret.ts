import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PUSH_SECRET_BYTES = 32;

const generatePushSecret = (): string => randomBytes(PUSH_SECRET_BYTES).toString("hex");

const hashPushSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

const verifyPushSecret = (presented: string, storedHash: string): boolean => {
  if (presented.length === 0) {
    return false;
  }

  const presentedHash = hashPushSecret(presented);
  if (presentedHash.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(presentedHash), Buffer.from(storedHash));
};

export { generatePushSecret, hashPushSecret, verifyPushSecret };
