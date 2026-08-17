import { describe, expect, test } from "vitest";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import { translateDestinationSync } from "../../src/index";
import { firstOf } from "../support/scenario";
import {
  mirrorRow,
  shadowOptions,
  slotIdentity,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  sourceCalendarA,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const translated = () => {
  const translation = translateDestinationSync(
    syncInput({
      storedSourceEvents: [storedSourceEvent({ identity })],
      mirrors: [mirrorRow({ identity })],
    }),
    shadowOptions(),
  );
  if (translation.kind !== "translated") {
    throw new Error(`expected a translation, got ${translation.reason}`);
  }
  return translation;
};

describe("one coverage constructor feeds both consumers", () => {
  test("SHADOW-I2: the synthesized listing and the policy agree on coverage by construction", () => {
    const unit = firstOf(translated().units);
    const source = unit.observed.source;
    if (source.kind !== "snapshot") {
      throw new Error(`expected a snapshot source listing, got ${source.kind}`);
    }
    const policyCoverage = unit.policy.coverageBySource.get(calendarKeyString(sourceCalendarA));
    if (!policyCoverage || policyCoverage.kind !== "proven") {
      throw new Error("expected proven coverage in the policy");
    }
    if (unit.proof.kind !== "proven") {
      throw new Error("expected a proven proof on the unit");
    }

    expect(policyCoverage).toEqual(unit.proof.coverage);
    expect(source.coverage.calendar).toEqual(sourceCalendarA);
    expect(source.coverage.covered).toEqual(unit.proof.covered);
  });

  test("SHADOW-I4: the listing claims no window the proof did not prove", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        storedCoverage: [
          storedCoverage({
            ingestWindowStart: "2026-02-01T00:00:00.000Z",
            ingestWindowEnd: "2026-08-01T00:00:00.000Z",
          }),
        ],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const source = firstOf(translation.units).observed.source;
    if (source.kind !== "snapshot") {
      throw new Error(`expected a snapshot source listing, got ${source.kind}`);
    }

    expect(source.coverage.covered.start.value).toBe("2026-02-01T00:00:00.000Z");
    expect(source.coverage.covered.end.value).toBe("2026-08-01T00:00:00.000Z");
  });

  test("SHADOW-I2: an unproven proof leaves the policy entry unproven and the listing partial", () => {
    const translation = translateDestinationSync(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
      }),
      shadowOptions({ maxCoverageAgeSeconds: 1 }),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const unit = firstOf(translation.units);

    expect(unit.observed.source.kind).toBe("partial");
    expect(unit.policy.coverageBySource.get(calendarKeyString(sourceCalendarA))).toEqual({
      kind: "unproven",
    });
  });
});
