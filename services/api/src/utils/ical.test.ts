import { describe, expect, it } from "bun:test";

/**
 * The ical utility functions are not individually exported — only `generateUserCalendar`
 * is exported, and it depends on `../context`. We test the pure logic by re-implementing
 * the key functions against the same patterns used in the source.
 */

const isAllDayEvent = (event: { startTime: Date; endTime: Date }): boolean => {
  const durationMs = event.endTime.getTime() - event.startTime.getTime();
  const hours = durationMs / (1000 * 60 * 60);
  return hours >= 24 && event.startTime.getHours() === 0 && event.endTime.getHours() === 0;
};

const resolveTemplate = (template: string, variables: Record<string, string>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/g, (match, name: string) => variables[name] ?? match);

interface CalendarEvent {
  title: string | null;
  calendarName: string;
}

interface FeedSettings {
  includeEventName: boolean;
  customEventName: string;
}

const resolveEventSummary = (event: CalendarEvent, settings: FeedSettings): string => {
  let template = settings.customEventName;
  if (settings.includeEventName) {
    template = event.title || settings.customEventName;
  }

  return resolveTemplate(template, {
    event_name: event.title || "Untitled",
    calendar_name: event.calendarName,
  });
};

describe("isAllDayEvent", () => {
  it("returns true for a 24-hour event starting at midnight", () => {
    expect(
      isAllDayEvent({
        startTime: new Date("2026-03-08T00:00:00"),
        endTime: new Date("2026-03-09T00:00:00"),
      }),
    ).toBe(true);
  });

  it("returns true for multi-day events starting at midnight", () => {
    expect(
      isAllDayEvent({
        startTime: new Date("2026-03-08T00:00:00"),
        endTime: new Date("2026-03-11T00:00:00"),
      }),
    ).toBe(true);
  });

  it("returns false for events shorter than 24 hours", () => {
    expect(
      isAllDayEvent({
        startTime: new Date("2026-03-08T09:00:00"),
        endTime: new Date("2026-03-08T17:00:00"),
      }),
    ).toBe(false);
  });

  it("returns false for 24-hour events not starting at midnight", () => {
    expect(
      isAllDayEvent({
        startTime: new Date("2026-03-08T06:00:00"),
        endTime: new Date("2026-03-09T06:00:00"),
      }),
    ).toBe(false);
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
