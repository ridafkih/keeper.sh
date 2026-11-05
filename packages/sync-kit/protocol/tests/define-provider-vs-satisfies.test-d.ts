import { describe, expectTypeOf, test } from "vitest";
import type { Capabilities } from "../src/index";

const googleCapabilities = {
  provider: "google",
  delta: { kind: "tokenized", windowBoundToCursor: true },
  deletionAuthority: "explicitRemovalsOnly",
  removalsAreAmbiguous: true,
  precondition: "matchesVersion",
  provenanceChannel: "extendedProperty",
  quotaScope: "perUser",
  throttleSignals: [{ status: 403, hasRetryAfter: false }],
  representableRange: {
    minimumSpanSeconds: 0,
    zeroDuration: "accept",
    invertedRange: "reject",
    allDayGrid: "utcDay",
  },
  allDay: "dateOnly",
  recurrenceWrite: "rfc5545",
  echoesWrites: true,
} satisfies Capabilities<"google">;

describe("defineProvider earns no place in the package", () => {
  test("satisfies preserves every literal an identity wrapper would have inferred", () => {
    expectTypeOf(googleCapabilities.provider).toEqualTypeOf<"google">();
    expectTypeOf(googleCapabilities.removalsAreAmbiguous).toEqualTypeOf<true>();
    expectTypeOf(googleCapabilities.delta).toEqualTypeOf<{
      kind: "tokenized";
      windowBoundToCursor: true;
    }>();
    expectTypeOf(googleCapabilities).toExtend<Capabilities<"google">>();
    expectTypeOf(googleCapabilities.representableRange.allDayGrid).toEqualTypeOf<"utcDay">();
  });
});
