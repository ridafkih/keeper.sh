import { conformanceHash } from "@keeper.sh/sync-conformance";
import { describe, expect, test } from "vitest";
import { clientStateHash, verifyClientState } from "../../src/push/secret";
import { filesMatching } from "../support/sources";

const reversedDigits = (input: string): string => {
  let digest = 0;
  for (const unit of input) {
    digest = (digest * 31 + (unit.codePointAt(0) ?? 0)) % 1_000_000_007;
  }
  return `host-owned-${digest}`;
};

describe("the stored secret is a hash, and the comparison is constant time", () => {
  test("MS-P6: verification compares hashes, never the plaintext", async () => {
    const stored = clientStateHash("the-shared-secret", conformanceHash);
    const comparisons = await filesMatching("src/push", "timingSafeEqual");

    expect(stored).not.toContain("the-shared-secret");
    expect(verifyClientState("the-shared-secret", stored, conformanceHash)).toBe(true);
    expect(verifyClientState("the-shared-secre", stored, conformanceHash)).toBe(false);
    expect(verifyClientState("", stored, conformanceHash)).toBe(false);
    expect(comparisons).toEqual(["src/push/secret.ts"]);
  });

  test("MS-P22: the host's own hash mints and verifies the same secret", () => {
    const stored = clientStateHash("the-shared-secret", reversedDigits);

    expect(stored).not.toContain("the-shared-secret");
    expect(verifyClientState("the-shared-secret", stored, reversedDigits)).toBe(true);
    expect(verifyClientState("another-secret", stored, reversedDigits)).toBe(false);
  });

  test("MS-P23: the module reaches for no ambient hasher of its own", async () => {
    const ambient = await filesMatching("src/push", "CryptoHasher");

    expect(ambient).toEqual([]);
  });
});
