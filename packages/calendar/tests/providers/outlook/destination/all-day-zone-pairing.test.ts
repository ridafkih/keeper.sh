import { describe, expect, it } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import { normalizeCalDAVEvent } from "../../../../src/providers/caldav/destination/normalize-event";
import { normalizeGoogleEvent } from "../../../../src/providers/google/destination/normalize-event";
import { normalizeOutlookEvent } from "../../../../src/providers/outlook/destination/normalize-event";
import { eventToICalString } from "../../../../src/providers/caldav/shared/ics";
import { serializeGoogleEvent } from "../../../../src/providers/google/destination/serialize-event";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";
import { parseEventDateTime } from "../../../../src/providers/outlook/shared/date-time";

const buildAllDayEvent = (startTimeZone: string): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-13T00:00:00.000Z"),
  eventStateId: "event-state-1",
  id: "event-state-1",
  isAllDay: true,
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-12T00:00:00.000Z"),
  startTimeZone,
  summary: "Company holiday",
} as MaterializedSyncableEvent);

const ZONES = [
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "America/New_York",
  "Pacific/Auckland",
  "UTC",
];

describe("the all-day value the Outlook serializer sends", () => {
  for (const zone of ZONES) {
    it(`names the UTC day the range covers in ${zone}`, () => {
      const event = buildAllDayEvent(zone);
      const serialized = serializeOutlookEvent(normalizeOutlookEvent(event));

      expect(serialized.isAllDay).toBe(true);
      expect(parseEventDateTime({
        dateTime: String(serialized.start?.dateTime),
        timeZone: String(serialized.start?.timeZone),
      }).toISOString()).toBe("2027-03-12T00:00:00.000Z");
      expect(parseEventDateTime({
        dateTime: String(serialized.end?.dateTime),
        timeZone: String(serialized.end?.timeZone),
      }).toISOString()).toBe("2027-03-13T00:00:00.000Z");
    });
  }

  it("names the same day the other destinations are given", () => {
    const event = buildAllDayEvent("Asia/Tokyo");

    const google = serializeGoogleEvent(normalizeGoogleEvent(event), "uid-1");
    const caldav = eventToICalString(normalizeCalDAVEvent(event), "uid-1");
    const outlook = serializeOutlookEvent(normalizeOutlookEvent(event));

    expect(google?.start?.date).toBe("2027-03-12");
    expect(caldav).toContain("DTSTART;VALUE=DATE:20270312");
    expect(parseEventDateTime({
      dateTime: String(outlook.start?.dateTime),
      timeZone: String(outlook.start?.timeZone),
    }).toISOString().slice(0, 10)).toBe("2027-03-12");
  });
});
