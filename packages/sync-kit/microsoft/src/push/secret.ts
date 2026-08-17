import { timingSafeEqual } from "node:crypto";

const clientStateHash = (secret: string, hash: (input: string) => string): string => hash(secret);

const verifyClientState = (
  presented: string,
  storedHash: string,
  hash: (input: string) => string,
): boolean => {
  if (presented.length === 0 || storedHash.length === 0) {
    return false;
  }
  const computed = Buffer.from(clientStateHash(presented, hash));
  const stored = Buffer.from(storedHash);
  if (computed.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(computed, stored);
};

export { clientStateHash, verifyClientState };
