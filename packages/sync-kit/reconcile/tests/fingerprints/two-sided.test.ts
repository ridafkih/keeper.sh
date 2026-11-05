import { describe, expect, test } from "vitest";
import { mirrorFingerprintOf, sameMirror, sameSource, sourceFingerprintOf } from "../../src/index";
import { fingerprint } from "../support/fixtures";

describe("the two fingerprint wrappers", () => {
  test("RECON-I11: a source fingerprint wraps its value without changing it", () => {
    expect(sourceFingerprintOf(fingerprint("abc"))).toEqual({
      kind: "sourceFingerprint",
      value: { kind: "fingerprint", value: "abc" },
    });
  });

  test("RECON-I11: a mirror fingerprint wraps its value without changing it", () => {
    expect(mirrorFingerprintOf(fingerprint("abc"))).toEqual({
      kind: "mirrorFingerprint",
      value: { kind: "fingerprint", value: "abc" },
    });
  });

  test("RECON-I12: reconcile hashes nothing, so identical inputs wrap identically", () => {
    expect(sourceFingerprintOf(fingerprint("abc"))).toEqual(sourceFingerprintOf(fingerprint("abc")));
  });

  test("RECON-O21: two source fingerprints with the same value compare equal", () => {
    expect(sameSource(sourceFingerprintOf(fingerprint("x")), sourceFingerprintOf(fingerprint("x")))).toBe(
      true,
    );
  });

  test("RECON-O21: two source fingerprints with different values compare unequal", () => {
    expect(sameSource(sourceFingerprintOf(fingerprint("x")), sourceFingerprintOf(fingerprint("y")))).toBe(
      false,
    );
  });

  test("RECON-O21: the mirror comparator is a separate relation with the same discipline", () => {
    expect(sameMirror(mirrorFingerprintOf(fingerprint("x")), mirrorFingerprintOf(fingerprint("x")))).toBe(
      true,
    );
    expect(sameMirror(mirrorFingerprintOf(fingerprint("x")), mirrorFingerprintOf(fingerprint("y")))).toBe(
      false,
    );
  });
});
