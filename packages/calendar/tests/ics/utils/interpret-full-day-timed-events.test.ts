import { describe, expect, it } from "vitest";
import { interpretFullDayTimedEventsAsAllDay } from "../../../src/ics/utils/interpret-full-day-timed-events";
import type { SourceEvent } from "../../../src/core/types";

const buildEvent = (overrides: Partial<SourceEvent> = {}): SourceEvent => ({
  endTime: new Date("2026-07-01T04:00:00.000Z"),
  startTime: new Date("2026-06-30T04:00:00.000Z"),
  title: "Busy",
  uid: "source-event-1",
  ...overrides,
});

describe("interpretFullDayTimedEventsAsAllDay", () => {
  it("keeps full-day timed events as timed when disabled", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [buildEvent()],
      { calendarTimeZone: "America/Toronto", enabled: false },
    );

    expect(event?.isAllDay).toBeUndefined();
  });

  it("treats local-midnight full-day timed events as all-day when enabled", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [buildEvent()],
      { calendarTimeZone: "America/Toronto", enabled: true },
    );

    expect(event?.isAllDay).toBe(true);
  });

  it("does not treat non-midnight 24-hour timed events as all-day", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [
        buildEvent({
          startTime: new Date("2026-06-30T17:00:00.000Z"),
          endTime: new Date("2026-07-01T17:00:00.000Z"),
        }),
      ],
      { calendarTimeZone: "America/Toronto", enabled: true },
    );

    expect(event?.isAllDay).toBeUndefined();
  });

  it("anchors a zone behind UTC on the UTC midnight of its local calendar day", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [
        buildEvent({
          startTime: new Date("2026-03-05T05:00:00.000Z"),
          endTime: new Date("2026-03-06T05:00:00.000Z"),
          startTimeZone: "America/New_York",
        }),
      ],
      { enabled: true },
    );

    expect(event?.startTime.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(event?.endTime.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });

  it("anchors a zone ahead of UTC on the UTC midnight of its local calendar day", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [
        buildEvent({
          startTime: new Date("2026-03-04T23:00:00.000Z"),
          endTime: new Date("2026-03-05T23:00:00.000Z"),
          startTimeZone: "Europe/Berlin",
        }),
      ],
      { enabled: true },
    );

    expect(event?.startTime.toISOString()).toBe("2026-03-05T00:00:00.000Z");
    expect(event?.endTime.toISOString()).toBe("2026-03-06T00:00:00.000Z");
  });

  it("drops the originating timezone once the event is anchored to UTC", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [buildEvent({ startTimeZone: "America/Toronto" })],
      { enabled: true },
    );

    expect(event?.startTimeZone).toBeUndefined();
  });

  it("leaves the times of events it does not interpret untouched", () => {
    const original = buildEvent({
      startTime: new Date("2026-06-30T17:00:00.000Z"),
      endTime: new Date("2026-07-01T17:00:00.000Z"),
    });
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [original],
      { calendarTimeZone: "America/Toronto", enabled: true },
    );

    expect(event).toBe(original);
  });

  it("uses the event timezone before the calendar timezone", () => {
    const [event] = interpretFullDayTimedEventsAsAllDay(
      [
        buildEvent({
          startTime: new Date("2026-06-30T07:00:00.000Z"),
          endTime: new Date("2026-07-01T07:00:00.000Z"),
          startTimeZone: "America/Los_Angeles",
        }),
      ],
      { calendarTimeZone: "America/Toronto", enabled: true },
    );

    expect(event?.isAllDay).toBe(true);
  });
});
