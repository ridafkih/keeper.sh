import { describe, expectTypeOf, test } from "vitest";
import type { MirrorFingerprint, SourceFingerprint } from "../../src/index";
import { sameMirror, sameSource } from "../../src/index";

describe("the two fingerprints are incomparable by construction", () => {
  test("RECON-O21: a source fingerprint is not assignable to a mirror fingerprint", () => {
    expectTypeOf<SourceFingerprint>().not.toMatchTypeOf<MirrorFingerprint>();
  });

  test("RECON-O21: a mirror fingerprint is not assignable to a source fingerprint", () => {
    expectTypeOf<MirrorFingerprint>().not.toMatchTypeOf<SourceFingerprint>();
  });

  test("RECON-O21: the source comparator refuses a mirror fingerprint", () => {
    expectTypeOf(sameSource).parameter(0).toEqualTypeOf<SourceFingerprint>();
    expectTypeOf(sameSource).parameter(1).toEqualTypeOf<SourceFingerprint>();
  });

  test("RECON-O21: the mirror comparator refuses a source fingerprint", () => {
    expectTypeOf(sameMirror).parameter(0).toEqualTypeOf<MirrorFingerprint>();
    expectTypeOf(sameMirror).parameter(1).toEqualTypeOf<MirrorFingerprint>();
  });

  test("RECON-I11: the two wrappers carry distinct discriminants", () => {
    expectTypeOf<SourceFingerprint["kind"]>().toEqualTypeOf<"sourceFingerprint">();
    expectTypeOf<MirrorFingerprint["kind"]>().toEqualTypeOf<"mirrorFingerprint">();
  });
});
