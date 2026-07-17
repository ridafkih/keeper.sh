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
  availability: "busy",
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
  describe("availability", () => {
    it("exports free events as transparent", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({ availability: "free" })],
        DEFAULT_SETTINGS,
      );

      expect(ics).toContain("TRANSP:TRANSPARENT");
    });

    it("does not export busy events as transparent", () => {
      const ics = formatEventsAsIcal(
        [makeEvent({ availability: "busy" })],
        DEFAULT_SETTINGS,
      );

      expect(ics).not.toContain("TRANSP:TRANSPARENT");
    });
  });

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

  /*
   * Regression: RFC 5545 §3.3.10 requires FREQ to be the first rule part in an
   * RRULE. ts-ics < 2.4.3 emitted BY* parts before FREQ (e.g.
   * RRULE:BYDAY=WE;FREQ=WEEKLY), which Apple Calendar silently fails to expand —
   * the recurring event then shows only at its master DTSTART and disappears
   * from current views.
   */
  it("emits RRULE with FREQ as the first rule part (RFC 5545)", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        isAllDay: false,
        startTime: new Date("2025-09-24T23:00:00Z"),
        endTime: new Date("2025-09-25T02:00:00Z"),
        recurrenceRule: { frequency: "WEEKLY", byDay: [{ day: "WE" }] } as never,
      })],
      DEFAULT_SETTINGS,
    );
    const rrule = ics.split(/\r?\n/).find((line) => line.startsWith("RRULE"));
    expect(rrule).toBeDefined();
    expect(rrule).toMatch(/^RRULE:FREQ=/);
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

  /*
   * Regression: the feed emits DTSTART as bare UTC, but source-parsed
   * exceptions carry a TZID (the `local` block). Emitting EXDATE with an IANA
   * TZID against a UTC DTSTART is an RFC 5545 value-type mismatch that makes
   * Apple Calendar drop the whole recurring event. EXDATE must be UTC too.
   */
  it("emits EXDATE in UTC even when the source exception carries a TZID", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        isAllDay: false,
        startTime: new Date("2025-09-24T23:00:00Z"),
        endTime: new Date("2025-09-25T02:00:00Z"),
        recurrenceRule: { frequency: "WEEKLY", byDay: [{ day: "WE" }] } as never,
        exceptionDates: [{
          date: new Date("2025-11-19T23:00:00Z"),
          type: "DATE-TIME",
          local: {
            date: new Date("2025-11-19T20:00:00Z"),
            timezone: "America/Montevideo",
            tzoffset: "-03:00",
          },
        }] as never,
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("DTSTART:20250924T230000Z");
    expect(ics).toContain("EXDATE");
    // Instant preserved, emitted as UTC, with no TZID parameter.
    expect(ics).toContain("20251119T230000Z");
    expect(ics).not.toContain("TZID=America/Montevideo");
  });

  it("emits RRULE UNTIL in UTC even when the source rule carries a TZID", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        isAllDay: false,
        startTime: new Date("2025-06-02T14:00:00Z"),
        endTime: new Date("2025-06-02T16:00:00Z"),
        recurrenceRule: {
          frequency: "WEEKLY",
          until: {
            date: new Date("2027-05-24T14:00:00Z"),
            type: "DATE-TIME",
            local: {
              date: new Date("2027-05-24T11:00:00Z"),
              timezone: "America/Montevideo",
              tzoffset: "-03:00",
            },
          },
        } as never,
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("UNTIL=20270524T140000Z");
    expect(ics).not.toContain("UNTIL=20270524T110000");
  });

  it("does not emit RRULE for one-off events", () => {
    const ics = formatEventsAsIcal([makeEvent()], DEFAULT_SETTINGS);
    expect(ics).not.toContain("RRULE:");
    expect(ics).not.toContain("EXDATE");
  });

  /*
   * Regression: when a recurring event has modified instances (e.g. an Outlook weekly meeting
   * where one occurrence is moved to a different time), each override arrives as a VEVENT with
   * the same UID as the master plus a RECURRENCE-ID pointing at the occurrence it replaces.
   * Previously each override landed in event_states as its own row but its RECURRENCE-ID was
   * discarded, and the feed emitted every row with its own UID. Calendar clients then showed
   * BOTH the master's RRULE-expanded occurrence AND the override as a separate event — visible
   * duplicate.
   *
   * Now: group rows by sourceEventUid, emit the master with its own UID, and emit each override
   * under the master's UID with RECURRENCE-ID linking back.
   */
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
    expect(ics).toMatch(/RRULE:[^\n]*FREQ=WEEKLY/);

    // Override reuses the master's UID and carries RECURRENCE-ID.
    expect(ics).toContain("RECURRENCE-ID");
    expect(ics).toContain("20260519T130000Z");
    expect(ics).toContain("DTSTART:20260519T173000Z");

    // The override-id is absorbed into the master's UID — never emitted standalone.
    expect(ics).not.toContain("UID:override-id@keeper.sh");
  });

  it("keeps expanded provider instances standalone when no recurring master exists", () => {
    const sourceUid = "google-expanded-series";
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "provider-instance-1",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-05-18T13:00:00Z"),
          endTime: new Date("2026-05-18T13:30:00Z"),
        }),
        makeEvent({
          id: "provider-instance-2",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-05-19T13:00:00Z"),
          endTime: new Date("2026-05-19T13:30:00Z"),
        }),
      ],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("UID:provider-instance-1@keeper.sh");
    expect(ics).toContain("UID:provider-instance-2@keeper.sh");
    expect(ics).not.toContain("RECURRENCE-ID");
    expect(ics.match(/UID:/g)).toHaveLength(2);
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

/*
 * Issue #413: Outlook classic renders bare-UTC feed events in "Coordinated
 * Universal Time" in the detail view. Per RFC 5545 a TZID must reference a
 * VTIMEZONE present in the object; emitting DTSTART;TZID=... alongside a real
 * VTIMEZONE makes Outlook show the correct local time.
 */
const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("timezone-aware feed (Outlook)", () => {
  it("emits DTSTART/DTEND with a TZID and a matching VTIMEZONE when startTimeZone is set", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        startTime: new Date("2026-06-17T10:45:00Z"),
        endTime: new Date("2026-06-17T11:45:00Z"),
        startTimeZone: "Europe/Berlin",
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:Europe/Berlin");
    // Berlin is +02:00 in June, so 10:45Z renders as 12:45 local.
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260617T124500");
    expect(ics).toContain("DTEND;TZID=Europe/Berlin:20260617T134500");
    expect(ics).not.toContain("DTSTART:20260617T104500Z");
  });

  it("keeps all-day events timezone-less even when startTimeZone is set", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({ isAllDay: true, startTimeZone: "Europe/Berlin" })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("DTSTART;VALUE=DATE:20260328");
    expect(ics).not.toContain("TZID=");
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });

  it("does not emit a VTIMEZONE when no event carries a timezone (UTC unchanged)", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        startTime: new Date("2026-06-17T10:45:00Z"),
        endTime: new Date("2026-06-17T11:45:00Z"),
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).not.toContain("BEGIN:VTIMEZONE");
    expect(ics).not.toContain("TZID=");
    expect(ics).toContain("DTSTART:20260617T104500Z");
  });

  it("zones EXDATE to match DTSTART while keeping RRULE UNTIL in UTC", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        startTime: new Date("2026-06-17T10:45:00Z"),
        endTime: new Date("2026-06-17T11:45:00Z"),
        startTimeZone: "Europe/Berlin",
        recurrenceRule: {
          frequency: "WEEKLY",
          until: { date: new Date("2026-12-30T10:45:00Z"), type: "DATE-TIME" },
        } as never,
        exceptionDates: [{ date: new Date("2026-07-01T10:45:00Z"), type: "DATE-TIME" }] as never,
      })],
      DEFAULT_SETTINGS,
    );

    // EXDATE carries the same TZID as DTSTART (RFC 5545 value-type match → Apple-safe).
    expect(ics).toContain("EXDATE;TZID=Europe/Berlin:20260701T124500");
    // UNTIL must stay UTC regardless of the event timezone.
    expect(ics).toContain("UNTIL=20261230T104500Z");
  });

  it("zones an override's RECURRENCE-ID to match the master's TZID", () => {
    const sourceUid = "berlin-meeting";
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "master-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-06-17T10:45:00Z"),
          endTime: new Date("2026-06-17T11:45:00Z"),
          startTimeZone: "Europe/Berlin",
          recurrenceRule: { frequency: "WEEKLY" } as never,
        }),
        makeEvent({
          id: "override-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-06-24T12:45:00Z"),
          endTime: new Date("2026-06-24T13:45:00Z"),
          startTimeZone: "Europe/Berlin",
          recurrenceId: new Date("2026-06-24T10:45:00Z"),
        }),
      ],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("RECURRENCE-ID;TZID=Europe/Berlin:20260624T124500");
  });

  it("preserves Apple recurrence invariants with the Outlook-compatible VTIMEZONE", () => {
    const sourceUid = "cross-client-recurring-event";
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "master-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-06-17T10:45:00Z"),
          endTime: new Date("2026-06-17T11:45:00Z"),
          startTimeZone: "Europe/Berlin",
          recurrenceRule: {
            frequency: "WEEKLY",
            until: { date: new Date("2026-12-30T10:45:00Z"), type: "DATE-TIME" },
          } as never,
          exceptionDates: [{ date: new Date("2026-07-01T10:45:00Z"), type: "DATE-TIME" }] as never,
        }),
        makeEvent({
          id: "override-id",
          sourceEventUid: sourceUid,
          startTime: new Date("2026-06-24T12:45:00Z"),
          endTime: new Date("2026-06-24T13:45:00Z"),
          startTimeZone: "Europe/Berlin",
          recurrenceId: new Date("2026-06-24T10:45:00Z"),
        }),
      ],
      DEFAULT_SETTINGS,
    );

    expect(occurrences(ics, "BEGIN:STANDARD")).toBe(1);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260617T124500");
    expect(ics).toContain("EXDATE;TZID=Europe/Berlin:20260701T124500");
    expect(ics).toContain("RECURRENCE-ID;TZID=Europe/Berlin:20260624T124500");
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;UNTIL=20261230T104500Z/);
  });

  it("emits a single VTIMEZONE per distinct zone", () => {
    const ics = formatEventsAsIcal(
      [
        makeEvent({ id: "a", startTime: new Date("2026-06-17T10:45:00Z"), endTime: new Date("2026-06-17T11:45:00Z"), startTimeZone: "Europe/Berlin" }),
        makeEvent({ id: "b", startTime: new Date("2026-06-18T10:45:00Z"), endTime: new Date("2026-06-18T11:45:00Z"), startTimeZone: "Europe/Berlin" }),
        makeEvent({ id: "c", startTime: new Date("2026-06-19T15:00:00Z"), endTime: new Date("2026-06-19T16:00:00Z"), startTimeZone: "America/New_York" }),
      ],
      DEFAULT_SETTINGS,
    );

    expect(occurrences(ics, "BEGIN:VTIMEZONE")).toBe(2);
    expect(ics).toContain("TZID:Europe/Berlin");
    expect(ics).toContain("TZID:America/New_York");
  });

  it("renders a January event before the year's first New York DST transition", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        startTime: new Date("2026-01-15T15:00:00Z"),
        endTime: new Date("2026-01-15T16:00:00Z"),
        startTimeZone: "America/New_York",
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("DTSTART;TZID=America/New_York:20260115T100000");
  });

  it("renders events after the VTIMEZONE reference year without empty observances", () => {
    const ics = formatEventsAsIcal(
      [
        makeEvent({
          id: "reference-year",
          startTime: new Date("2026-06-17T10:45:00Z"),
          endTime: new Date("2026-06-17T11:45:00Z"),
          startTimeZone: "Europe/Berlin",
        }),
        makeEvent({
          id: "following-year",
          startTime: new Date("2027-01-15T10:45:00Z"),
          endTime: new Date("2027-01-15T11:45:00Z"),
          startTimeZone: "Europe/Berlin",
        }),
      ],
      DEFAULT_SETTINGS,
    );

    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20270115T114500");
  });

  it("falls back to bare UTC for an unresolvable timezone", () => {
    const ics = formatEventsAsIcal(
      [makeEvent({
        startTime: new Date("2026-06-17T10:45:00Z"),
        endTime: new Date("2026-06-17T11:45:00Z"),
        startTimeZone: "Not/AZone",
      })],
      DEFAULT_SETTINGS,
    );

    expect(ics).not.toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("DTSTART:20260617T104500Z");
  });
});
