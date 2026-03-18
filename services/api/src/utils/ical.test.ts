import { describe, expect, it } from "bun:test";
import { formatEventsAsIcal } from "./ical-format";
import type { CalendarEvent } from "./ical-format";

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
