import { describe, expect, test } from "vitest";
import { calendarKeyString } from "@keeper.sh/sync-reconcile";
import { translateDestinationSync } from "../../src/index";
import { cataloged, runShadow } from "../support/scenario";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const keptA = slotIdentity("evt-a-kept", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const goneB = slotIdentity("evt-b-gone", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");

const mapped = [sourceCalendarA, sourceCalendarB];

const twoSourceInput = () =>
  syncInput({
    mappedSourceCalendars: mapped,
    witness: witnessFor(mapped),
    storedCoverage: [
      storedCoverage({ calendar: sourceCalendarA }),
      storedCoverage({ calendar: sourceCalendarB }),
    ],
    storedSourceEvents: [storedSourceEvent({ identity: keptA, sourceCalendar: sourceCalendarA })],
    mirrors: [
      mirrorRow({ identity: keptA, sourceCalendar: sourceCalendarA }),
      mirrorRow({ identity: goneB, sourceCalendar: sourceCalendarB }),
    ],
    destinationListing: destinationSnapshot({
      events: [
        ownMirrorEvent({ id: "mirror-evt-a-kept", uid: "evt-a-kept" }),
        ownMirrorEvent({ id: "mirror-evt-b-gone", uid: "evt-b-gone" }),
      ],
    }),
  });

describe("one plan per source calendar", () => {
  test("SHADOW-I22: two source calendars produce two plans and one catalog", () => {
    const translation = translateDestinationSync(twoSourceInput(), shadowOptions());
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }
    const keys = translation.units.map((unit) => calendarKeyString(unit.sourceCalendar));

    expect(translation.units.length).toBe(2);
    expect(new Set(keys).size).toBe(2);
    expect(cataloged(runShadow(twoSourceInput())).kind).toBe("cataloged");
  });

  test("SHADOW-I22: a deletion names the source calendar it came from", () => {
    const catalog = cataloged(runShadow(twoSourceInput()));
    const deleted = catalog.deletions.filter((entry) => entry.uid.value === "evt-b-gone");

    expect(deleted.length).toBe(1);
    for (const entry of deleted) {
      expect(entry.sourceCalendar).toEqual(sourceCalendarB);
      expect(entry.destinationCalendar).toEqual(catalog.destination);
    }
  });

  test("SHADOW-I22: every known row in a unit belongs to that unit's source calendar", () => {
    const translation = translateDestinationSync(twoSourceInput(), shadowOptions());
    if (translation.kind !== "translated") {
      throw new Error(`expected a translation, got ${translation.reason}`);
    }

    for (const unit of translation.units) {
      expect(unit.known.calendar).toEqual(unit.sourceCalendar);
      for (const event of unit.known.events) {
        expect(calendarKeyString(event.sourceCalendar)).toBe(
          calendarKeyString(unit.sourceCalendar),
        );
      }
    }
  });
});
