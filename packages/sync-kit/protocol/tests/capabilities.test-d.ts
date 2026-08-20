import { describe, expectTypeOf, test } from "vitest";
import type { Capabilities, DeltaSupport, RepresentableRange, ThrottleSignal } from "../src/index";

declare const acceptDeltaSupport: (delta: DeltaSupport) => void;

describe("a provider declares its constraints as data", () => {
  test("delta support cannot be declared without saying whether the window is bound to the cursor", () => {
    // @ts-expect-error widening a window silently strands it when the range lives in the token
    acceptDeltaSupport({ kind: "tokenized" });
    expectTypeOf<
      Extract<DeltaSupport, { kind: "tokenized" }>["windowBoundToCursor"]
    >().toEqualTypeOf<boolean>();
  });

  test("removal ambiguity is a required declaration", () => {
    expectTypeOf<Capabilities["removalsAreAmbiguous"]>().toEqualTypeOf<boolean>();
  });

  test("the representable range is a required declaration", () => {
    expectTypeOf<Capabilities["representableRange"]>().toEqualTypeOf<RepresentableRange>();
    expectTypeOf<RepresentableRange["minimumSpanSeconds"]>().toBeNumber();
  });

  test("throttle signals are data, never parsed from an error message", () => {
    expectTypeOf<Capabilities["throttleSignals"]>().toEqualTypeOf<readonly ThrottleSignal[]>();
    expectTypeOf<Capabilities<"google">["provider"]>().toEqualTypeOf<"google">();
  });
});
