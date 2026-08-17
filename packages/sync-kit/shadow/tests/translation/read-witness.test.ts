import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import {
  shadowOptions,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  syncInput,
} from "../support/fixtures";

describe("the post-lock read witness", () => {
  test("SHADOW-I7: a changed source calendar set refuses the translation", () => {
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: [sourceCalendarA],
        storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
        witness: {
          sourceCalendarsBeforeRemoteRead: [sourceCalendarA],
          sourceCalendarsAtLocalRead: [sourceCalendarA, sourceCalendarB],
          coverageNarrowedAfterRemoteRead: true,
        },
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("sourceCalendarSetChangedDuringRead");
  });

  test("SHADOW-I7: a source that disappeared during the read refuses just as loudly", () => {
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: [sourceCalendarA],
        storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
        witness: {
          sourceCalendarsBeforeRemoteRead: [sourceCalendarA, sourceCalendarB],
          sourceCalendarsAtLocalRead: [sourceCalendarA],
          coverageNarrowedAfterRemoteRead: true,
        },
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("sourceCalendarSetChangedDuringRead");
  });

  test("SHADOW-I7: the same set in a different order is not a change", () => {
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: [sourceCalendarA, sourceCalendarB],
        storedCoverage: [
          storedCoverage({ calendar: sourceCalendarA }),
          storedCoverage({ calendar: sourceCalendarB }),
        ],
        witness: {
          sourceCalendarsBeforeRemoteRead: [sourceCalendarA, sourceCalendarB],
          sourceCalendarsAtLocalRead: [sourceCalendarB, sourceCalendarA],
          coverageNarrowedAfterRemoteRead: true,
        },
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("translated");
  });
});
