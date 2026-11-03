import { describe, expect, it } from "vitest";
import { serializeOutlookEvent } from "../../../../src/providers/outlook/destination/serialize-event";

const zonesThatStoppedFallingBack = [
  { localStart: "2026-11-05T10:00:00.000", startTime: "2026-11-05T16:00:00.000Z", timeZone: "America/Edmonton" },
  { localStart: "2026-11-05T10:00:00.000", startTime: "2026-11-05T17:00:00.000Z", timeZone: "America/Vancouver" },
  { localStart: "2026-11-05T10:00:00.000", startTime: "2026-11-05T15:00:00.000Z", timeZone: "America/Winnipeg" },
  { localStart: "2026-11-05T10:00:00.000", startTime: "2026-11-05T14:00:00.000Z", timeZone: "America/Havana" },
];

describe("serializeOutlookEvent after a zone abolished daylight saving time", () => {
  it.each(zonesThatStoppedFallingBack)(
    "keeps a $timeZone meeting at its local start instead of an hour early",
    ({ localStart, startTime, timeZone }) => {
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

      expect(event.start).toEqual({ dateTime: localStart, timeZone });
    },
  );
});
