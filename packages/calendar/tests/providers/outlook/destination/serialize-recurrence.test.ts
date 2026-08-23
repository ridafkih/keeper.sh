import { describe, expect, it } from "vitest";
import { buildOutlookRecurrence } from "../../../../src/providers/outlook/destination/serialize-recurrence";
import type { SyncableEvent } from "../../../../src/core/types";

const baseEvent: SyncableEvent = {
  calendarId: "calendar-id",
  calendarName: "Calendar",
  calendarUrl: null,
  endTime: new Date("2026-01-19T19:30:00.000Z"),
  id: "event-id",
  sourceEventUid: "source-uid",
  startTime: new Date("2026-01-19T16:30:00.000Z"),
  summary: "Coachen",
};

describe("buildOutlookRecurrence", () => {
  it("returns undefined when there is no recurrence rule", () => {
    expect(buildOutlookRecurrence(baseEvent)).toBeUndefined();
  });

  it("maps a biweekly WEEKLY rule to Outlook's weekly pattern with no end", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: { frequency: "WEEKLY", interval: 2 },
    });

    expect(recurrence).toEqual({
      pattern: { daysOfWeek: ["monday"], interval: 2, type: "weekly" },
      range: { startDate: "2026-01-19", type: "noEnd" },
    });
  });

  it("maps a DAILY rule with an until date to Outlook's endDate range", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: { frequency: "DAILY", interval: 1, until: { date: new Date("2026-02-01T00:00:00.000Z") } },
    });

    expect(recurrence).toEqual({
      pattern: { interval: 1, type: "daily" },
      range: { endDate: "2026-02-01", startDate: "2026-01-19", type: "endDate" },
    });
  });

  it("maps a MONTHLY rule with byMonthday to Outlook's absoluteMonthly pattern", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: { byMonthday: [15], frequency: "MONTHLY", interval: 1 },
    });

    expect(recurrence?.pattern).toEqual({ dayOfMonth: 15, interval: 1, type: "absoluteMonthly" });
  });

  it("maps a MONTHLY rule with a byDay occurrence to Outlook's relativeMonthly pattern", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: {
        byDay: [{ day: "MO", occurrence: -1 }],
        frequency: "MONTHLY",
        interval: 1,
      },
    });

    expect(recurrence?.pattern).toEqual({
      daysOfWeek: ["monday"],
      index: "last",
      interval: 1,
      type: "relativeMonthly",
    });
  });

  it("maps a rule with a count to Outlook's numbered range", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: { count: 5, frequency: "WEEKLY", interval: 1 },
    });

    expect(recurrence?.range).toEqual({ numberOfOccurrences: 5, startDate: "2026-01-19", type: "numbered" });
  });

  it("returns undefined for sub-daily frequencies unsupported by Microsoft Graph", () => {
    const recurrence = buildOutlookRecurrence({
      ...baseEvent,
      recurrenceRule: { frequency: "HOURLY", interval: 1 },
    });

    expect(recurrence).toBeUndefined();
  });
});
