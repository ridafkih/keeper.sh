import { describe, expect, test } from "vitest";
import { translateDestinationSync } from "../../src/index";
import { instant } from "../support/handles";
import { firstOf } from "../support/scenario";
import {
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const requestedWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2026-12-31T00:00:00.000Z"),
};

const unitFor = () => {
  const translation = translateDestinationSync(
    syncInput({
      mirrorWindow: requestedWindow,
      storedSourceEvents: [storedSourceEvent({ identity })],
      mirrors: [mirrorRow({ identity })],
      storedCoverage: [
        storedCoverage({
          ingestWindowStart: "2026-02-01T00:00:00.000Z",
          ingestWindowEnd: "2026-04-01T00:00:00.000Z",
          historicRange: {
            start: instant("2026-02-01T00:00:00.000Z"),
            end: instant("2026-03-01T00:00:00.000Z"),
          },
          futureRange: {
            start: instant("2026-03-01T00:00:00.000Z"),
            end: instant("2026-04-01T00:00:00.000Z"),
          },
        }),
      ],
    }),
    shadowOptions(),
  );
  if (translation.kind !== "translated") {
    throw new Error(`expected a translation, got ${translation.reason}`);
  }
  return firstOf(translation.units);
};

describe("the mirror-window retirement path is unreachable by construction", () => {
  test("SHADOW-I10: the scope window and the mirror window are the same value", () => {
    const unit = unitFor();

    expect(unit.observed.source.scope.window).toEqual(unit.policy.mirrorWindow);
    expect(unit.observed.source.scope.window).toEqual(requestedWindow);
  });

  test("SHADOW-I10: the scope window is not the recorded coverage window", () => {
    const unit = unitFor();

    expect(unit.observed.source.scope.window.end.value).not.toBe("2026-04-01T00:00:00.000Z");
  });

  test("SHADOW-I10: the scope names the source calendar it was built for", () => {
    const unit = unitFor();

    expect(unit.observed.source.scope.calendar).toEqual(unit.sourceCalendar);
    expect(unit.observed.source.scope.expandRecurrences).toBe(false);
  });
});
