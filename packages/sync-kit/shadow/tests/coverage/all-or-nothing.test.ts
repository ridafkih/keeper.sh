import { describe, expect, test } from "vitest";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import { translateDestinationSync } from "../../src/index";
import {
  mirrorRow,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const identityA = slotIdentity("evt-a", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const identityB = slotIdentity("evt-b", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");

describe("deletion authority is all or nothing across mapped sources", () => {
  test("SHADOW-I5: one unresolvable source makes every source unproven", () => {
    const mapped = [sourceCalendarA, sourceCalendarB];
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: mapped,
        witness: witnessFor(mapped),
        storedSourceEvents: [
          storedSourceEvent({ identity: identityA, sourceCalendar: sourceCalendarA }),
          storedSourceEvent({ identity: identityB, sourceCalendar: sourceCalendarB }),
        ],
        mirrors: [
          mirrorRow({ identity: identityA, sourceCalendar: sourceCalendarA }),
          mirrorRow({ identity: identityB, sourceCalendar: sourceCalendarB }),
        ],
        storedCoverage: [
          storedCoverage({ calendar: sourceCalendarA }),
          storedCoverage({ calendar: sourceCalendarB, ingestWindowStart: null }),
        ],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }

    expect(translation.units.length).toBe(2);
    for (const unit of translation.units) {
      expect(unit.proof.kind).toBe("unproven");
      expect(unit.observed.source.kind).toBe("partial");
      expect(unit.policy.coverageBySource.get(calendarKeyString(unit.sourceCalendar))).toEqual({
        kind: "unproven",
      });
    }
  });

  test("SHADOW-I5: the source that could not be proven names the sibling that broke it", () => {
    const mapped = [sourceCalendarA, sourceCalendarB];
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: mapped,
        witness: witnessFor(mapped),
        mirrors: [
          mirrorRow({ identity: identityA, sourceCalendar: sourceCalendarA }),
          mirrorRow({ identity: identityB, sourceCalendar: sourceCalendarB }),
        ],
        storedCoverage: [
          storedCoverage({ calendar: sourceCalendarA }),
          storedCoverage({ calendar: sourceCalendarB, ingestWindowStart: null }),
        ],
      }),
      shadowOptions(),
    );
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const refusals = translation.units.flatMap((unit) => {
      if (unit.proof.kind !== "unproven") {
        return [];
      }
      return [unit.proof.refusal];
    });

    expect(refusals).toContain("siblingSourceUnproven");
    expect(refusals).toContain("noRecordedIngestWindow");
  });

  test("SHADOW-I5: zero mapped source calendars refuses the translation", () => {
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: [],
        witness: witnessFor([]),
        storedCoverage: [],
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("noMappedSourceCalendars");
  });

  test("SHADOW-I5: a mapped source with no stored coverage row at all refuses", () => {
    const translation = translateDestinationSync(
      syncInput({
        mappedSourceCalendars: [sourceCalendarA, sourceCalendarB],
        witness: witnessFor([sourceCalendarA, sourceCalendarB]),
        storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
      }),
      shadowOptions(),
    );

    expect(translation.kind).toBe("refused");
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }
    expect(translation.reason).toBe("storedCoverageMissingForMappedSource");
  });
});
