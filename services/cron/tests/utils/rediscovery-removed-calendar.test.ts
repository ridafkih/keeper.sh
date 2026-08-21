import { describe, expect, it } from "vitest";
import { planCalendarRediscovery } from "@keeper.sh/calendar";
import type { DiscoveredCalendar, ExistingCalendar } from "@keeper.sh/calendar";

const KEPT_KEY = "external-kept";
const REMOVED_KEY = "external-removed";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");
const ENUMERATION_STARTED_AT = new Date("2026-08-21T00:00:00.000Z");
const NOTHING = 0;
const ONE_CALENDAR = 1;

const discoveredCalendar = (identityKey: string, name: string): DiscoveredCalendar => ({
  calendarUrl: null,
  externalCalendarId: identityKey,
  identityKey,
  name,
  writable: true,
});

const existingCalendar = (identityKey: string, id: string): ExistingCalendar => ({
  calendarUrl: null,
  createdAt: CREATED_AT,
  id,
  identityKey,
  unavailableSince: null,
});

describe("rediscovery after a user removes a calendar", () => {
  it("does not re-import a calendar the user removed", () => {
    const plan = planCalendarRediscovery({
      discovered: [
        discoveredCalendar(KEPT_KEY, "Kept"),
        discoveredCalendar(REMOVED_KEY, "Removed"),
      ],
      enumerationStartedAt: ENUMERATION_STARTED_AT,
      existing: [existingCalendar(KEPT_KEY, "calendar-kept")],
      removedKeys: new Set([REMOVED_KEY]),
    });

    expect(plan.toInsert.map((calendar) => calendar.identityKey)).toEqual([]);
    expect(plan.removedSkippedCount).toBe(ONE_CALENDAR);
  });

  it("still imports a genuinely new calendar while a removal is recorded", () => {
    const plan = planCalendarRediscovery({
      discovered: [
        discoveredCalendar(KEPT_KEY, "Kept"),
        discoveredCalendar(REMOVED_KEY, "Removed"),
      ],
      enumerationStartedAt: ENUMERATION_STARTED_AT,
      existing: [],
      removedKeys: new Set([REMOVED_KEY]),
    });

    expect(plan.toInsert.map((calendar) => calendar.identityKey)).toEqual([KEPT_KEY]);
    expect(plan.crossAccountSkippedCount).toBe(NOTHING);
  });
});
