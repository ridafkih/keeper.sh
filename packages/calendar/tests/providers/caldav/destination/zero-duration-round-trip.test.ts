import { describe, expect, it } from "vitest";
import type { MaterializedSyncableEvent } from "../../../../src/core/types";
import {
  eventToICalString,
  parseICalToRemoteEvent,
} from "../../../../src/providers/caldav/shared/ics";
import { normalizeCalDAVEvent } from "../../../../src/providers/caldav/destination/normalize-event";

const buildEvent = (
  overrides: Partial<MaterializedSyncableEvent>,
): MaterializedSyncableEvent => ({
  availability: "busy",
  calendarId: "source-calendar",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2027-03-08T16:00:00.000Z"),
  id: "event-state-1",
  sourceEventUid: "source-uid",
  startTime: new Date("2027-03-08T16:00:00.000Z"),
  startTimeZone: "UTC",
  summary: "Point in time",
  ...overrides,
} as MaterializedSyncableEvent);

const getIcsLine = (ics: string, name: string): string =>
  ics.split(/\r?\n/).find((line) => line.startsWith(name)) ?? "";

const pushICalString = (event: MaterializedSyncableEvent): string =>
  eventToICalString(normalizeCalDAVEvent(event), "keeper-uid");

describe("caldav destination representation of degenerate ranges", () => {
  it("emits an all-day event whose DTEND is later than its DTSTART", () => {
    const ics = pushICalString(buildEvent({
      endTime: new Date("2027-03-08T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-08T00:00:00.000Z"),
    }));

    expect(getIcsLine(ics, "DTSTART")).toBe("DTSTART;VALUE=DATE:20270308");
    expect(getIcsLine(ics, "DTEND")).toBe("DTEND;VALUE=DATE:20270309");
  });

  it("emits an inverted all-day event with DTEND after DTSTART", () => {
    const ics = pushICalString(buildEvent({
      endTime: new Date("2027-03-05T00:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2027-03-10T00:00:00.000Z"),
    }));

    const parsed = parseICalToRemoteEvent(ics);

    expect(parsed?.startTime).toEqual(new Date("2027-03-10T00:00:00.000Z"));
    expect(parsed?.endTime.getTime()).toBeGreaterThan(parsed?.startTime.getTime() ?? 0);
  });

  it("emits an inverted timed event with DTEND after DTSTART", () => {
    const ics = pushICalString(buildEvent({
      endTime: new Date("2027-03-08T15:00:00.000Z"),
      startTime: new Date("2027-03-08T16:00:00.000Z"),
    }));

    const parsed = parseICalToRemoteEvent(ics);

    expect(parsed?.startTime).toEqual(new Date("2027-03-08T16:00:00.000Z"));
    expect(parsed?.endTime.getTime()).toBeGreaterThan(parsed?.startTime.getTime() ?? 0);
  });

  it("emits a zero-duration timed event with DTEND after DTSTART", () => {
    const ics = pushICalString(buildEvent({}));

    const parsed = parseICalToRemoteEvent(ics);

    expect(parsed?.startTime).toEqual(new Date("2027-03-08T16:00:00.000Z"));
    expect(parsed?.endTime.getTime()).toBeGreaterThan(parsed?.startTime.getTime() ?? 0);
  });
});

describe("caldav destination normalized round trip stability", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    { event: buildEvent({}), name: "timed zero-duration event" },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T15:00:00.000Z"),
        startTime: new Date("2027-03-08T16:00:00.000Z"),
      }),
      name: "inverted timed event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-08T00:00:00.000Z"),
      }),
      name: "same-date all-day event",
    },
    {
      event: buildEvent({
        endTime: new Date("2027-03-05T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-10T00:00:00.000Z"),
      }),
      name: "inverted all-day event",
    },
  ];

  for (const testCase of cases) {
    it(`reads a normalized ${testCase.name} back at the range it was pushed with`, () => {
      const normalized = normalizeCalDAVEvent(testCase.event);

      const parsed = parseICalToRemoteEvent(eventToICalString(normalized, "keeper-uid"));

      expect(parsed?.startTime).toEqual(normalized.startTime);
      expect(parsed?.endTime).toEqual(normalized.endTime);
      expect(normalizeCalDAVEvent(normalized)).toEqual(normalized);
    });
  }
});

describe("caldav destination round trip stability", () => {
  const cases: { name: string; event: MaterializedSyncableEvent }[] = [
    { event: buildEvent({}), name: "timed zero-duration event" },
    {
      event: buildEvent({
        endTime: new Date("2027-03-08T00:00:00.000Z"),
        isAllDay: true,
        startTime: new Date("2027-03-08T00:00:00.000Z"),
      }),
      name: "same-date all-day event",
    },
  ];

  for (const testCase of cases) {
    it(`reads back a ${testCase.name} at the range it was written with`, () => {
      const ics = eventToICalString(testCase.event, "keeper-uid");

      const parsed = parseICalToRemoteEvent(ics);

      expect(parsed?.startTime).toEqual(testCase.event.startTime);
      expect(parsed?.endTime).toEqual(testCase.event.endTime);
    });
  }
});
