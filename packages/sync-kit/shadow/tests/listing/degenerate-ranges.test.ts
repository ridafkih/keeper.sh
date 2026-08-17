import { describe, expect, test } from "vitest";
import {
  decodeStoredCanonicalEvent,
  sourceCoverageFrom,
  synthesizeSourceListing,
} from "../../src/index";
import {
  allDayOn,
  asOf,
  completeRead,
  mirrorWindow,
  slotIdentity,
  sourceCalendarA,
  storedCoverage,
  storedSourceEvent,
  timedAt,
} from "../support/fixtures";

const degenerate = [
  {
    identity: slotIdentity("evt-zero", "2026-03-10T09:00:00.000Z", "2026-03-10T09:00:00.000Z"),
    time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T09:00:00.000Z"),
  },
  {
    identity: slotIdentity("evt-inverted", "2026-03-10T10:00:00.000Z", "2026-03-10T09:00:00.000Z"),
    time: timedAt("2026-03-10T10:00:00.000Z", "2026-03-10T09:00:00.000Z"),
  },
  {
    identity: slotIdentity("evt-onems", "2026-03-10T09:00:00.000Z", "2026-03-10T09:00:00.001Z"),
    time: timedAt("2026-03-10T09:00:00.000Z", "2026-03-10T09:00:00.001Z"),
  },
  {
    identity: slotIdentity("evt-allday-zero", "2026-03-10T00:00:00.000Z", "2026-03-10T00:00:00.000Z"),
    time: allDayOn("2026-03-10", "2026-03-10"),
  },
  {
    identity: slotIdentity("evt-allday-long", "2026-03-10T00:00:00.000Z", "2027-03-10T00:00:00.000Z"),
    time: allDayOn("2026-03-10", "2027-03-10"),
  },
];

describe("degenerate ranges are legitimate present events", () => {
  test("SHADOW-I25: five degenerate ranges are forwarded unchanged", () => {
    const listing = synthesizeSourceListing({
      sourceCalendar: sourceCalendarA,
      mirrorWindow,
      storedSourceEvents: degenerate.map((entry) => storedSourceEvent(entry)),
      completeness: completeRead(),
      proof: sourceCoverageFrom({
        stored: storedCoverage(),
        mirrorWindow,
        asOf,
        maxCoverageAgeSeconds: 86_400,
      }),
      decodeStored: decodeStoredCanonicalEvent,
    });

    expect(listing.events.length).toBe(5);
    for (const entry of degenerate) {
      const found = listing.events.find((event) => event.uid.value === entry.identity.uid.value);
      if (!found || found.content.recurrence) {
        throw new Error(`expected a single-occurrence ${entry.identity.uid.value} in the listing`);
      }
      expect(found.content.time).toEqual(entry.time);
    }
  });
});
