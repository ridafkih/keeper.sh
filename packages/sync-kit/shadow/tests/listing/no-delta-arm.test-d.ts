import { describe, expectTypeOf, test } from "vitest";
import type { SynthesizedSourceListing } from "../../src/index";

describe("a stored read has no removal signal", () => {
  test("SHADOW-I8: a synthesized source listing is never a delta", () => {
    expectTypeOf<Extract<SynthesizedSourceListing, { kind: "delta" }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<SynthesizedSourceListing, { kind: "cursorLost" }>>().toEqualTypeOf<never>();
    expectTypeOf<SynthesizedSourceListing["kind"]>().not.toEqualTypeOf<"delta">();
  });
});
