import { describe, expect, it } from "vitest";
import {
  generatePushSecret,
  hashPushSecret,
  verifyPushSecret,
} from "../../../src/core/source/push-secret";

const HEX_64 = /^[0-9a-f]{64}$/;

describe("generatePushSecret", () => {
  it("produces 64 lowercase hex characters", () => {
    expect(generatePushSecret()).toMatch(HEX_64);
  });

  it("never repeats across a thousand draws", () => {
    const drawn = new Set<string>();
    for (let index = 0; index < 1000; index++) {
      drawn.add(generatePushSecret());
    }
    expect(drawn.size).toBe(1000);
  });
});

describe("hashPushSecret", () => {
  it("produces a fixed-width digest regardless of input length", () => {
    expect(hashPushSecret("a")).toMatch(HEX_64);
    expect(hashPushSecret("b".repeat(4096))).toMatch(HEX_64);
  });

  it("is deterministic", () => {
    expect(hashPushSecret("secret-1")).toBe(hashPushSecret("secret-1"));
    expect(hashPushSecret("secret-1")).not.toBe(hashPushSecret("secret-2"));
  });
});

describe("verifyPushSecret", () => {
  it("accepts the secret that produced the stored hash", () => {
    const secret = generatePushSecret();
    expect(verifyPushSecret(secret, hashPushSecret(secret))).toBe(true);
  });

  it("rejects a same-length wrong secret", () => {
    const stored = hashPushSecret(generatePushSecret());
    expect(verifyPushSecret(generatePushSecret(), stored)).toBe(false);
  });

  it("rejects a differing-length secret without throwing", () => {
    const secret = generatePushSecret();
    const stored = hashPushSecret(secret);

    expect(() => verifyPushSecret("x", stored)).not.toThrow();
    expect(verifyPushSecret("x", stored)).toBe(false);
    expect(() => verifyPushSecret("y".repeat(300), stored)).not.toThrow();
    expect(verifyPushSecret("y".repeat(300), stored)).toBe(false);
  });

  it("rejects an empty presented secret", () => {
    const secret = generatePushSecret();
    expect(verifyPushSecret("", hashPushSecret(secret))).toBe(false);
  });

  it("rejects a thousand random wrong secrets without a single exception", () => {
    const stored = hashPushSecret(generatePushSecret());
    let accepted = 0;
    let threw = 0;

    for (let index = 0; index < 1000; index++) {
      try {
        if (verifyPushSecret(generatePushSecret().slice(0, index % 65), stored)) {
          accepted += 1;
        }
      } catch {
        threw += 1;
      }
    }

    expect(accepted).toBe(0);
    expect(threw).toBe(0);
  });

  it("rejects a presented value that is already the stored hash", () => {
    const secret = generatePushSecret();
    const stored = hashPushSecret(secret);
    expect(verifyPushSecret(stored, stored)).toBe(false);
  });
});
