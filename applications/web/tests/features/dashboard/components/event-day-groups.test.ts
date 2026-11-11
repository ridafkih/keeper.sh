import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupEventsByDay } from "../../../../src/features/dashboard/components/event-day-groups";
import type { CalendarEvent } from "../../../../src/hooks/use-events";
import { runInTimeZone } from "../../../helpers/time-zone";

const event = (id: string, startIso: string, endIso: string, isAllDay: boolean): CalendarEvent => ({
  id,
  eventStateId: null,
  title: id,
  description: null,
  location: null,
  startTime: new Date(startIso),
  endTime: new Date(endIso),
  isAllDay,
  color: null,
  calendarColor: null,
  calendarId: "calendar",
  calendarName: "Calendar",
  calendarProvider: "google",
  calendarUrl: "https://calendar.example",
});

const summarize = (events: CalendarEvent[]) =>
  groupEventsByDay(events).map((group) => ({ label: group.label, ids: group.events.map(({ id }) => id) }));

describe("groupEventsByDay west of UTC", () => {
  runInTimeZone("America/Edmonton");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists an all-day event under its own date", () => {
    const allDay = event("holiday", "2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z", true);
    expect(summarize([allDay])).toEqual([{ label: "Thursday, Nov 5", ids: ["holiday"] }]);
  });

  it("orders days and events by their local start, all-day first", () => {
    const eveningBefore = event("evening", "2026-11-05T01:00:00.000Z", "2026-11-05T02:00:00.000Z", false);
    const allDay = event("holiday", "2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z", true);
    const morning = event("morning", "2026-11-05T16:00:00.000Z", "2026-11-05T17:00:00.000Z", false);
    expect(summarize([allDay, eveningBefore, morning])).toEqual([
      { label: "Wednesday, Nov 4", ids: ["evening"] },
      { label: "Thursday, Nov 5", ids: ["holiday", "morning"] },
    ]);
  });
});

describe("groupEventsByDay east of UTC", () => {
  runInTimeZone("Asia/Tokyo");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts an all-day event ahead of that date's early-morning events", () => {
    const earlyMorning = event("early", "2026-11-04T22:00:00.000Z", "2026-11-04T23:00:00.000Z", false);
    const allDay = event("holiday", "2026-11-05T00:00:00.000Z", "2026-11-06T00:00:00.000Z", true);
    expect(summarize([earlyMorning, allDay])).toEqual([{ label: "Thursday, Nov 5", ids: ["holiday", "early"] }]);
  });
});
