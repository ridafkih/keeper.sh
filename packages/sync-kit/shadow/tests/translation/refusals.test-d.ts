import { describe, expectTypeOf, test } from "vitest";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { TranslationRefusal } from "../../src/index";

const labelOf = (reason: TranslationRefusal): string => {
  switch (reason) {
    case "noMappedSourceCalendars":
    case "sourceCalendarSetChangedDuringRead":
    case "unnormalizedLocalEvents":
    case "normalizedForAnotherProvider":
    case "nonCanonicalInstant":
    case "mirrorWindowInverted":
    case "destinationListingIsNotThisDestination":
    case "mirrorPointsAtAnotherDestination":
    case "duplicateSourceIdentityClaim":
    case "storedCoverageMissingForMappedSource":
    case "withheldCountsDisagreeWithWithheldList":
    case "rowOnAnUnmappedSourceCalendar": {
      return reason;
    }
    default: {
      return assertNever(reason);
    }
  }
};

describe("the refusal union", () => {
  test("SHADOW-I29: a switch over the refusal reasons is exhaustive", () => {
    expectTypeOf(labelOf).parameter(0).toEqualTypeOf<TranslationRefusal>();
    expectTypeOf(labelOf).returns.toEqualTypeOf<string>();
    expectTypeOf<TranslationRefusal>().not.toEqualTypeOf<string>();
  });
});
