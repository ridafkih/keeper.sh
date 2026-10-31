import { describe, expectTypeOf, test } from "vitest";
import type {
  CalendarDate,
  EditableContent,
  Instant,
  OccurrenceDuration,
  RecurrenceAnchor,
  RecurrencePayload,
  RecurringContent,
  ZoneId,
} from "../src/index";

declare const instant: Instant;
declare const calendarDate: CalendarDate;
declare const zone: ZoneId;
declare const recurrence: RecurrencePayload;

declare const acceptContent: (content: EditableContent) => void;
declare const acceptAnchor: (anchor: RecurrenceAnchor) => void;

const described = {
  title: "standup",
  description: null,
  location: null,
  availability: "busy",
  visibility: "default",
} as const;

describe("a recurring master carries the wall time it recurs on", () => {
  test("a series cannot be pinned to instants alone", () => {
    // @ts-expect-error two absolute instants cannot be re-expanded across a DST transition
    acceptContent({ ...described, recurrence, time: { kind: "timed", start: instant, end: instant, zone } });
  });

  test("a timed series anchor cannot omit its zone", () => {
    // @ts-expect-error a floating master expands to a different hour on either side of a transition
    acceptAnchor({ kind: "timed", start: instant, duration: { kind: "exact", seconds: 1800 } });
    expectTypeOf<Extract<RecurrenceAnchor, { kind: "timed" }>["zone"]>().toEqualTypeOf<ZoneId>();
  });

  test("a nominal duration is not an exact one", () => {
    expectTypeOf<OccurrenceDuration>().toEqualTypeOf<
      | { readonly kind: "exact"; readonly seconds: number }
      | { readonly kind: "nominal"; readonly days: number }
    >();
    acceptAnchor({
      kind: "allDay",
      startDate: calendarDate,
      // @ts-expect-error an all-day occurrence is a count of days, never a fixed span of seconds
      duration: { kind: "exact", seconds: 86_400 },
    });
    acceptAnchor({ kind: "allDay", startDate: calendarDate, duration: { kind: "nominal", days: 1 } });
  });

  test("a single occurrence carries no recurrence anchor and no nominal duration", () => {
    acceptContent({
      ...described,
      recurrence: null,
      time: { kind: "timed", start: instant, end: instant, zone },
    });
    acceptContent({
      ...described,
      recurrence: null,
      // @ts-expect-error a one-off event has no series anchor to re-resolve
      anchor: { kind: "timed", start: instant, zone, duration: { kind: "exact", seconds: 60 } },
    });
    expectTypeOf<RecurringContent["recurrence"]>().toEqualTypeOf<RecurrencePayload>();
  });
});
