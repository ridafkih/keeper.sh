import { describe, expect, it } from "vitest";
import { formatEventsAsIcal } from "../../src/utils/ical-format";
import type { CalendarEvent } from "../../src/utils/ical-format";

const resolveTemplate = (template: string, variables: Record<string, string>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) => variables[name] ?? match);

interface SummaryEvent {
  title: string | null;
  calendarName: string;
}

interface SummarySettings {
  includeEventName: boolean;
  customEventName: string;
}

const resolveEventSummary = (event: SummaryEvent, settings: SummarySettings): string => {
  let template = settings.customEventName;
  if (settings.includeEventName) {
    template = event.title || settings.customEventName;
  }

  return resolveTemplate(template, {
    event_name: event.title || "Untitled",
    calendar_name: event.calendarName,
  });
};

const DEFAULT_SETTINGS = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

const makeEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "test-event-id",
  title: "Test Event",
  description: null,
  location: null,
  startTime: new Date("2026-03-28T00:00:00Z"),
  endTime: new Date("2026-03-29T00:00:00Z"),
  isAllDay: false,
  calendarName: "Work",
  recurrenceRule: null,
  exceptionDates: null,
  recurrenceId: null,
  sourceEventUid: null,
  ...overrides,
});

describe("formatEventsAsIcal", () => {
  describe("all-day events", () => {
    it("emits VALUE=DATE for all-day events instead of datetime", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({ isAllDay: true })],
        DEFAULT_SETTINGS,
      );

      expect(ics).toContain("DTSTART;VALUE=DATE:20260328");
      expect(ics).toContain("DTEND;VALUE=DATE:20260329");
      expect(ics).not.toContain("DTSTART:20260328T000000Z");
      expect(ics).not.toContain("DTEND:20260329T000000Z");
    });

    it("emits datetime format for non-all-day events", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({
          isAllDay: false,
          startTime: new Date("2026-03-28T09:00:00Z"),
          endTime: new Date("2026-03-28T17:00:00Z"),
        })],
        DEFAULT_SETTINGS,
      );

      expect(ics).toContain("DTSTART:20260328T090000Z");
      expect(ics).toContain("DTEND:20260328T170000Z");
    });

    it("infers all-day when isAllDay is null and times are midnight UTC", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({ isAllDay: null })],
        DEFAULT_SETTINGS,
      );

      expect(ics).toContain("DTSTART;VALUE=DATE:20260328");
      expect(ics).toContain("DTEND;VALUE=DATE:20260329");
    });

    it("filters all-day events when excludeAllDayEvents is true", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({ isAllDay: true })],
        { ...DEFAULT_SETTINGS, excludeAllDayEvents: true },
      );

      expect(ics).not.toContain("Test Event");
      expect(ics).not.toContain("test-event-id");
    });
  });
});

describe("resolveTemplate", () => {
  it("replaces known variables in template", () => {
    expect(resolveTemplate("{{calendar_name}}", { calendar_name: "Work" })).toBe("Work");
  });

  it("replaces multiple variables", () => {
    expect(
      resolveTemplate("{{event_name}} - {{calendar_name}}", {
        calendar_name: "Work",
        event_name: "Meeting",
      }),
    ).toBe("Meeting - Work");
  });

  it("leaves unknown tokens unchanged", () => {
    expect(resolveTemplate("{{unknown}}", {})).toBe("{{unknown}}");
  });

  it("returns template as-is when no tokens present", () => {
    expect(resolveTemplate("Busy", { calendar_name: "Work" })).toBe("Busy");
  });
});

describe("resolveEventSummary", () => {
  it("uses custom event name when includeEventName is false", () => {
    const result = resolveEventSummary(
      { title: "Team Meeting", calendarName: "Work" },
      { includeEventName: false, customEventName: "Busy" },
    );
    expect(result).toBe("Busy");
  });

  it("uses event title when includeEventName is true", () => {
    const result = resolveEventSummary(
      { title: "Team Meeting", calendarName: "Work" },
      { includeEventName: true, customEventName: "Busy" },
    );
    expect(result).toBe("Team Meeting");
  });

  it("falls back to custom event name when title is null and includeEventName is true", () => {
    const result = resolveEventSummary(
      { title: null, calendarName: "Work" },
      { includeEventName: true, customEventName: "Busy" },
    );
    expect(result).toBe("Busy");
  });

  it("resolves template variables in custom event name", () => {
    const result = resolveEventSummary(
      { title: "Sprint Planning", calendarName: "Engineering" },
      { includeEventName: false, customEventName: "{{calendar_name}}: {{event_name}}" },
    );
    expect(result).toBe("Engineering: Sprint Planning");
  });

  it("uses 'Untitled' for event_name variable when title is null", () => {
    const result = resolveEventSummary(
      { title: null, calendarName: "Work" },
      { includeEventName: false, customEventName: "{{event_name}}" },
    );
    expect(result).toBe("Untitled");
  });
});

describe("recurring events", () => {
  /*
   * Regression: previously the formatter dropped recurrenceRule and emitted each recurring event
   * as a single one-off VEVENT (matching the master's DTSTART only). Calendar clients would then
   * show one occurrence in the distant past instead of the expected weekly/yearly/etc. recurrences.
   */
  it("emits RRULE for events with a recurrenceRule", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        isAllDay: false,
        startTime: new Date("2025-10-06T18:00:00Z"),
        endTime: new Date("2025-10-06T22:30:00Z"),
        recurrenceRule: { frequency: "WEEKLY", byDay: [{ day: "MO" }, { day: "TU" }, { day: "WE" }, { day: "TH" }, { day: "FR" }] } as never,
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("RRULE:");
    expect(ics).toContain("FREQ=WEEKLY");
    expect(ics).toMatch(/BYDAY=MO,TU,WE,TH,FR|BYDAY=MO;BYDAY=TU/);
  });

  it("emits EXDATE for events with exceptionDates", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        isAllDay: false,
        startTime: new Date("2025-10-06T18:00:00Z"),
        endTime: new Date("2025-10-06T22:30:00Z"),
        recurrenceRule: { frequency: "WEEKLY" } as never,
        exceptionDates: [{ date: new Date("2026-04-02T18:00:00Z"), type: "DATE-TIME" }] as never,
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("RRULE:");
    expect(ics).toContain("EXDATE");
    expect(ics).toContain("20260402T180000Z");
  });

  it("does not emit RRULE for one-off events", () => {
    const ics = formatEventsAsIcal([makeEvent()], DEFAULT_SETTINGS);
    expect(ics).not.toContain("RRULE:");
    expect(ics).not.toContain("EXDATE");
  });

  // Regression: when a recurring event has modified instances (e.g. an Outlook
  // weekly meeting where one occurrence is moved to a different time), each
  // override arrives as a VEVENT with the same UID as the master plus a
  // RECURRENCE-ID pointing at the occurrence it replaces. Previously each
  // override landed in event_states as its own row but its RECURRENCE-ID was
  // discarded, and the feed emitted every row with its own UID. Calendar
  // clients then showed BOTH the master's RRULE-expanded occurrence AND the
  // override as a separate event — visible duplicate.
  //
  // Now: group rows by sourceEventUid, emit the master with its own UID, and
  // emit each override under the master's UID with RECURRENCE-ID linking back.
  it("groups master + overrides under a single UID with RECURRENCE-ID", () => {
    const sourceUid = "outlook-meeting-123";
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "master-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-02-03T13:00:00Z"),
          endTime: new Date("2026-02-03T13:30:00Z"),
          recurrenceRule: { frequency: "WEEKLY", byDay: [{ day: "MO" }, { day: "TU" }, { day: "WE" }, { day: "TH" }, { day: "FR" }] } as never,
        }),
        makeEvent({
          id: "override-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-05-19T17:30:00Z"),
          endTime: new Date("2026-05-19T18:00:00Z"),
          recurrenceId: new Date("2026-05-19T13:00:00Z"),
        }),
      ],
      DEFAULT_SETTINGS,
    );

    // Master is emitted with its own UID and RRULE.
    expect(ics).toContain("UID:master-id@keeper.sh");
    expect(ics).toContain("RRULE:FREQ=WEEKLY");

    // Override reuses the master's UID and carries RECURRENCE-ID.
    expect(ics).toContain("RECURRENCE-ID");
    expect(ics).toContain("20260519T130000Z");
    expect(ics).toContain("DTSTART:20260519T173000Z");

    // The override-id is absorbed into the master's UID — never emitted standalone.
    expect(ics).not.toContain("UID:override-id@keeper.sh");
  });

  it("emits standalone UIDs for events lacking sourceEventUid", () => {
    const ics = formatEventsAsIcal(
      [
        makeEvent({ id: "loose-1", sourceEventUid: null }),
        makeEvent({ id: "loose-2", sourceEventUid: null }),
      ],
      DEFAULT_SETTINGS,
    );
    expect(ics).toContain("UID:loose-1@keeper.sh");
    expect(ics).toContain("UID:loose-2@keeper.sh");
    expect(ics).not.toContain("RECURRENCE-ID");
  });
});
