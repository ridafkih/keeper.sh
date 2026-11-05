import { describe, expect, it } from "vitest";
import { serializeGoogleEvent } from "../../src/providers/google/destination/serialize-event";
import { serializeOutlookEvent } from "../../src/providers/outlook/destination/serialize-event";
import { eventToICalString } from "../../src/providers/caldav/shared/ics";
import type { MaterializedSyncableEvent } from "../../src/core/types";

const createEvent = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  calendarId: "calendar-id",
  calendarName: "Calendar",
  calendarUrl: null,
  endTime: new Date("2026-03-09T17:00:00.000Z"),
  id: "event-id",
  sourceEventUid: "source-uid",
  startTime: new Date("2026-03-09T16:00:00.000Z"),
  summary: "Team lunch",
  ...overrides,
});

const withoutStamp = (ics: string): string => ics.replace(/DTSTAMP:.*\r?\n/, "");

describe("google copies of events with reminders disabled", () => {
  it("opt out of the calendar's default reminders and set none of their own", () => {
    const event = serializeGoogleEvent(createEvent({ remindersDisabled: true }), "destination-uid");

    expect(event?.reminders).toEqual({ overrides: [], useDefault: false });
  });

  it("leave reminders to the calendar when the option is off", () => {
    const event = serializeGoogleEvent(createEvent(), "destination-uid");

    expect(event).not.toHaveProperty("reminders");
  });
});

describe("outlook copies of events with reminders disabled", () => {
  it("turn the reminder off", () => {
    const event = serializeOutlookEvent(createEvent({ remindersDisabled: true }));

    expect(event.isReminderOn).toBe(false);
  });

  it("leave the reminder to the mailbox when the option is off", () => {
    const event = serializeOutlookEvent(createEvent());

    expect(event).not.toHaveProperty("isReminderOn");
  });
});

describe("caldav copies of events", () => {
  it("carry no alarm when reminders are disabled", () => {
    const icsString = eventToICalString(createEvent({ remindersDisabled: true }), "destination-uid");

    expect(icsString).not.toContain("BEGIN:VALARM");
  });

  it("are written the same whether or not reminders are disabled", () => {
    const withReminders = eventToICalString(createEvent(), "destination-uid");
    const withoutReminders = eventToICalString(createEvent({ remindersDisabled: true }), "destination-uid");

    expect(withoutStamp(withoutReminders)).toBe(withoutStamp(withReminders));
  });
});
