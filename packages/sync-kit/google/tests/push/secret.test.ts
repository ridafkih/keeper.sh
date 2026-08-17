import { describe, expect, test } from "vitest";
import { verifyChannelToken } from "../../src/push/secret";

const other = (input: string): string => `other:${input}`;

const sha256 = (input: string): string =>
  new Bun.CryptoHasher("sha256").update(input).digest("hex");

describe("a channel token is verified against a stored hash", () => {
  test("GOOG-P2: the presented token is compared against the stored hash, never stored in the clear", () => {
    expect(verifyChannelToken("the-real-token", sha256("the-real-token"), sha256)).toBe(true);
  });

  test("GOOG-P2: a token that is wrong in its first byte is refused", () => {
    expect(verifyChannelToken("Xhe-real-token", sha256("the-real-token"), sha256)).toBe(false);
  });

  test("GOOG-P2: an empty presentation against an empty stored hash is refused", () => {
    expect(verifyChannelToken("", "", sha256)).toBe(false);
  });

  test("GOOG-P2: the digest arrives as an argument, so a different one verifies its own tokens", () => {
    expect(verifyChannelToken("the-real-token", other("the-real-token"), other)).toBe(true);
    expect(verifyChannelToken("the-real-token", sha256("the-real-token"), other)).toBe(false);
  });
});
