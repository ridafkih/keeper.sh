import type { EventTime, OccurrenceDuration, RecurrenceAnchor, RecurrencePayload } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CanonicalEvent } from "./canonical-event";
import { canonicalFieldOrder } from "./canonical-event";

const fieldSeparator = String.fromCodePoint(0);
const absentSentinel = String.fromCodePoint(1);
const partSeparator = String.fromCodePoint(31);

const sortedDistinct = (values: readonly string[]): string =>
  [...new Set(values)].toSorted().join(",");

const encodedText = (value: string | null): string => {
  if (value === null) {
    return absentSentinel;
  }
  return value;
};

const encodedTime = (time: EventTime | undefined): string => {
  if (!time) {
    return absentSentinel;
  }
  switch (time.kind) {
    case "timed": {
      return ["timed", time.start.value, time.end.value, time.zone?.value ?? absentSentinel].join(
        partSeparator,
      );
    }
    case "allDay": {
      return ["allDay", time.startDate.value, time.endDateExclusive.value].join(partSeparator);
    }
    default: {
      return assertNever(time);
    }
  }
};

const encodedRecurrence = (recurrence: RecurrencePayload | null | undefined): string => {
  if (!recurrence) {
    return absentSentinel;
  }
  return [recurrence.dialect, recurrence.value, sortedDistinct(recurrence.exceptions)].join(
    partSeparator,
  );
};

const encodedDuration = (duration: OccurrenceDuration): string => {
  switch (duration.kind) {
    case "exact": {
      return `exact${partSeparator}${duration.seconds}`;
    }
    case "nominal": {
      return `nominal${partSeparator}${duration.days}`;
    }
    default: {
      return assertNever(duration);
    }
  }
};

const encodedAnchor = (anchor: RecurrenceAnchor | undefined): string => {
  if (!anchor) {
    return absentSentinel;
  }
  switch (anchor.kind) {
    case "timed": {
      return ["timed", anchor.start.value, anchor.zone.value, encodedDuration(anchor.duration)].join(
        partSeparator,
      );
    }
    case "allDay": {
      return ["allDay", anchor.startDate.value, String(anchor.duration.days)].join(partSeparator);
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const encodeCanonicalEvent = (event: CanonicalEvent): string => {
  const fields = {
    title: event.content.title,
    description: encodedText(event.content.description),
    location: encodedText(event.content.location),
    availability: event.content.availability,
    visibility: event.content.visibility,
    time: encodedTime(event.content.time),
    recurrence: encodedRecurrence(event.content.recurrence),
    anchor: encodedAnchor(event.content.anchor),
    cancellations: sortedDistinct(event.cancellations.map((instant) => instant.value)),
  } satisfies Record<(typeof canonicalFieldOrder)[number], string>;
  return canonicalFieldOrder.map((field) => fields[field]).join(fieldSeparator);
};

export { absentSentinel, encodeCanonicalEvent, fieldSeparator };
