import { describe, expect, it } from "vitest";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";

const zonesThatStoppedFallingBack = [
  { startTime: "2026-11-05T16:00:00.000Z", timeZone: "America/Edmonton" },
  { startTime: "2026-11-05T17:00:00.000Z", timeZone: "America/Vancouver" },
  { startTime: "2026-11-05T15:00:00.000Z", timeZone: "America/Winnipeg" },
  { startTime: "2026-11-05T14:00:00.000Z", timeZone: "America/Havana" },
];

describe("serializeOutlookEvent after a zone abolished daylight saving time", () => {
  it.each(zonesThatStoppedFallingBack)(
    "writes a $timeZone meeting at its UTC instant, not an hour early",
    ({ startTime, timeZone }) => {
      const start = new Date(startTime);
      const event = serializeOutlookEvent({
        calendarId: "calendar-id",
        calendarName: "Calendar",
        calendarUrl: null,
        endTime: new Date(start.getTime() + 60 * 60 * 1000),
        id: "event-id",
        sourceEventUid: "source-uid",
        startTime: start,
        startTimeZone: timeZone,
        summary: "Local meeting",
      });

      expect(event.start).toEqual({ dateTime: startTime.replace("Z", ""), timeZone: "UTC" });
    },
  );
});
