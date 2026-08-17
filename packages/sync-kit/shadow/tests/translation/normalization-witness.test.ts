import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import { firstOf } from "../support/scenario";
import {
  allDayOn,
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
  timedAt,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const zeroDuration = slotIdentity(
  "evt-zero",
  "2026-03-11T09:00:00.000Z",
  "2026-03-11T09:00:00.000Z",
);
const allDay = slotIdentity("evt-allday", "2026-03-12T00:00:00.000Z", "2026-03-13T00:00:00.000Z");

describe("normalization is the caller's, and the shadow does none", () => {
  test("SHADOW-I24: a witness for another provider refuses the translation", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        normalization: { appliedBy: "caller", provider: "google" },
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("normalizedForAnotherProvider");
  });

  test("SHADOW-I24: the shadow does not itself alter any event time", () => {
    const zeroTime = timedAt("2026-03-11T09:00:00.000Z", "2026-03-11T09:00:00.000Z");
    const allDayTime = allDayOn("2026-03-12", "2026-03-13");
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [
          storedSourceEvent({ identity: zeroDuration, time: zeroTime }),
          storedSourceEvent({ identity: allDay, time: allDayTime }),
        ],
        mirrors: [mirrorRow({ identity: zeroDuration }), mirrorRow({ identity: allDay })],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const listed = firstOf(translation.units).observed.source.events ?? [];
    const forwarded = listed.flatMap((event) => {
      if (event.content.recurrence) {
        return [];
      }
      return [event.content.time];
    });

    expect(forwarded).toEqual([zeroTime, allDayTime]);
  });
});
