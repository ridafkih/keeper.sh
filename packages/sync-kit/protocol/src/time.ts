import type { CalendarKey } from "./calendar-ref";
import type { CalendarDate, Instant, ZoneId } from "./handles";

interface TimeWindow {
  readonly start: Instant;
  readonly end: Instant;
}

interface CoverageWindow {
  readonly covered: TimeWindow;
  readonly calendar: CalendarKey;
}

type EventTime =
  | {
      readonly kind: "timed";
      readonly start: Instant;
      readonly end: Instant;
      readonly zone: ZoneId | null;
    }
  | {
      readonly kind: "allDay";
      readonly startDate: CalendarDate;
      readonly endDateExclusive: CalendarDate;
    };

type OccurrenceDuration =
  | { readonly kind: "exact"; readonly seconds: number }
  | { readonly kind: "nominal"; readonly days: number };

type NominalDuration = Extract<OccurrenceDuration, { kind: "nominal" }>;

type RecurrenceAnchor =
  | {
      readonly kind: "timed";
      readonly start: Instant;
      readonly zone: ZoneId;
      readonly duration: OccurrenceDuration;
    }
  | {
      readonly kind: "allDay";
      readonly startDate: CalendarDate;
      readonly duration: NominalDuration;
    };

type WindowMembership = (window: TimeWindow, time: EventTime) => boolean;

export type {
  CoverageWindow,
  EventTime,
  NominalDuration,
  OccurrenceDuration,
  RecurrenceAnchor,
  TimeWindow,
  WindowMembership,
};
