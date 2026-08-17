import type {
  CalendarDate,
  EditableContent,
  EventTime,
  Instant,
  NormalizedContent,
  OccurrenceDuration,
  RecurrenceAnchor,
  RepresentabilityConstraint,
  Result,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { microsoftFingerprint } from "../fingerprint";

const resolvesAsZone = (value: string): boolean => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
};

const canonicalInstant = (instant: Instant): Instant => ({
  kind: "instant",
  value: new Date(Date.parse(instant.value)).toISOString(),
});

const clampedEnd = (start: Instant, end: Instant): Instant => {
  const from = Date.parse(start.value);
  if (Date.parse(end.value) < from) {
    return canonicalInstant(start);
  }
  return canonicalInstant(end);
};

const clampedEndDate = (startDate: CalendarDate, endDateExclusive: CalendarDate): CalendarDate => {
  if (endDateExclusive.value < startDate.value) {
    return startDate;
  }
  return endDateExclusive;
};

const shapedTime = (time: EventTime): EventTime => {
  switch (time.kind) {
    case "allDay": {
      return {
        kind: "allDay",
        startDate: time.startDate,
        endDateExclusive: clampedEndDate(time.startDate, time.endDateExclusive),
      };
    }
    case "timed": {
      return {
        kind: "timed",
        start: canonicalInstant(time.start),
        end: clampedEnd(time.start, time.end),
        zone: time.zone,
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const shapedAnchor = (anchor: RecurrenceAnchor): RecurrenceAnchor => {
  switch (anchor.kind) {
    case "allDay": {
      return anchor;
    }
    case "timed": {
      return { ...anchor, start: canonicalInstant(anchor.start) };
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const shapeForMicrosoft = (content: EditableContent): EditableContent => {
  const described = {
    title: content.title,
    description: content.description,
    location: content.location,
    availability: content.availability,
    visibility: content.visibility,
  };
  if (content.recurrence === null) {
    return { ...described, recurrence: null, time: shapedTime(content.time) };
  }
  return { ...described, recurrence: content.recurrence, anchor: shapedAnchor(content.anchor) };
};

const unresolvable = (zone: ZoneId | null): boolean => {
  if (zone === null) {
    return false;
  }
  return !resolvesAsZone(zone.value);
};

const unreadableInstant = (instant: Instant): boolean => Number.isNaN(Date.parse(instant.value));

/*
  ECMA-262 sec-time-values-and-time-range gives a Date ±8.64e15 ms; arithmetic that leaves that
  range yields an Invalid Date whose toISOString throws rather than returning a value.
*/
const latestRepresentableMs = 8.64e15;

const millisecondsInSecond = 1000;
const dayMs = 24 * 60 * 60 * millisecondsInSecond;

const spanMillisecondsOf = (duration: OccurrenceDuration): number => {
  switch (duration.kind) {
    case "exact": {
      return duration.seconds * millisecondsInSecond;
    }
    case "nominal": {
      return duration.days * dayMs;
    }
    default: {
      return assertNever(duration);
    }
  }
};

const outsideDateRange = (fromMs: number, duration: OccurrenceDuration): boolean => {
  const span = spanMillisecondsOf(duration);
  if (!Number.isFinite(span)) {
    return true;
  }
  return Math.abs(fromMs + span) > latestRepresentableMs;
};

const timedViolation = (
  time: Extract<EventTime, { kind: "timed" }>,
): RepresentabilityConstraint | null => {
  if (unresolvable(time.zone)) {
    return "zoneIdentifier";
  }
  if (unreadableInstant(time.start) || unreadableInstant(time.end)) {
    return "invertedRange";
  }
  return null;
};

const allDayViolation = (
  time: Extract<EventTime, { kind: "allDay" }>,
): RepresentabilityConstraint | null => {
  const from = Date.parse(`${time.startDate.value}T00:00:00.000Z`);
  const until = Date.parse(`${time.endDateExclusive.value}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(until)) {
    return "allDayGrid";
  }
  return null;
};

const occurrenceViolation = (time: EventTime): RepresentabilityConstraint | null => {
  switch (time.kind) {
    case "allDay": {
      return allDayViolation(time);
    }
    case "timed": {
      return timedViolation(time);
    }
    default: {
      return assertNever(time);
    }
  }
};

const allDayAnchorViolation = (
  anchor: Extract<RecurrenceAnchor, { kind: "allDay" }>,
): RepresentabilityConstraint | null => {
  const from = Date.parse(`${anchor.startDate.value}T00:00:00.000Z`);
  if (Number.isNaN(from) || outsideDateRange(from, anchor.duration)) {
    return "allDayGrid";
  }
  return null;
};

const anchorViolation = (anchor: RecurrenceAnchor): RepresentabilityConstraint | null => {
  switch (anchor.kind) {
    case "allDay": {
      return allDayAnchorViolation(anchor);
    }
    case "timed": {
      if (unresolvable(anchor.zone)) {
        return "zoneIdentifier";
      }
      if (unreadableInstant(anchor.start)) {
        return "invertedRange";
      }
      if (outsideDateRange(Date.parse(anchor.start.value), anchor.duration)) {
        return "minimumSpan";
      }
      return null;
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const constraintViolatedBy = (content: EditableContent): RepresentabilityConstraint | null => {
  if (content.recurrence === null) {
    return occurrenceViolation(content.time);
  }
  return anchorViolation(content.anchor);
};

const normalizeForMicrosoft = (
  content: EditableContent,
  hash: (input: string) => string,
): Result<NormalizedContent<"microsoft">> => {
  const constraint = constraintViolatedBy(content);
  if (constraint !== null) {
    return { ok: false, failure: { kind: "unrepresentable", constraint } };
  }
  const shaped = shapeForMicrosoft(content);
  return {
    ok: true,
    value: {
      kind: "normalized",
      provider: "microsoft",
      content: shaped,
      fingerprint: microsoftFingerprint(shaped, hash),
    },
  };
};

export { constraintViolatedBy, normalizeForMicrosoft, resolvesAsZone, shapeForMicrosoft };
