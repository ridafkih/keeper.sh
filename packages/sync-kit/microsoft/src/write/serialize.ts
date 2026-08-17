import type {
  Availability,
  EditableContent,
  EventTime,
  Instant,
  NormalizedContent,
  OccurrenceDuration,
  Provenance,
  RecurrenceAnchor,
  Visibility,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ZoneCache } from "@keeper.sh/sync-ical";
import type {
  DateTimeTimeZone,
  Event as GraphEvent,
  FreeBusyStatus,
  Sensitivity,
  SingleValueLegacyExtendedProperty,
} from "@microsoft/microsoft-graph-types";
import {
  mirroredUidPropertyName,
  recurrencePropertyName,
  singleValueProperty,
} from "../decode/extended-property";
import { provenanceCategory, provenancePropertyName } from "../decode/provenance";
import { withPreservedRegion } from "./online-meeting";
import { emittableDateTime, roundTrips, utcZone, utcZoneName } from "./wall-time";

interface SerializeInputs {
  readonly content: NormalizedContent<"microsoft">;
  readonly provenance: Extract<Provenance, { kind: "ours" }> | null;
  readonly idempotencyKey: string | null;
  readonly preservedBody: string | null;
  readonly existing: GraphEvent | null;
  readonly zones: ZoneCache;
}

interface SerializedSpan {
  readonly start: DateTimeTimeZone;
  readonly end: DateTimeTimeZone;
  readonly isAllDay: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;
const millisecondsInSecond = 1000;

const showAsOf = (availability: Availability): FreeBusyStatus => {
  switch (availability) {
    case "free": {
      return "free";
    }
    case "busy": {
      return "busy";
    }
    default: {
      return assertNever(availability);
    }
  }
};

const sensitivityOf = (visibility: Visibility): Sensitivity => {
  switch (visibility) {
    case "private": {
      return "private";
    }
    case "default":
    case "public": {
      return "normal";
    }
    default: {
      return assertNever(visibility);
    }
  }
};

const utcMidnight = (date: string): DateTimeTimeZone => ({
  dateTime: `${date}T00:00:00.0000000`,
  timeZone: utcZoneName,
});

const emissionZone = (
  start: Instant,
  end: Instant,
  zone: ZoneId | null,
  zones: ZoneCache,
): ZoneId => {
  if (zone === null) {
    return utcZone;
  }
  if (!roundTrips(start, zone, zones) || !roundTrips(end, zone, zones)) {
    return utcZone;
  }
  return zone;
};

const timedSpan = (
  start: Instant,
  end: Instant,
  zone: ZoneId | null,
  zones: ZoneCache,
): SerializedSpan => {
  const emitted = emissionZone(start, end, zone, zones);
  return {
    start: emittableDateTime(start, emitted, zones),
    end: emittableDateTime(end, emitted, zones),
    isAllDay: false,
  };
};

const spanOfTime = (time: EventTime, zones: ZoneCache): SerializedSpan => {
  switch (time.kind) {
    case "allDay": {
      return {
        start: utcMidnight(time.startDate.value),
        end: utcMidnight(time.endDateExclusive.value),
        isAllDay: true,
      };
    }
    case "timed": {
      return timedSpan(time.start, time.end, time.zone, zones);
    }
    default: {
      return assertNever(time);
    }
  }
};

const shiftedDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * dayMs).toISOString().slice(0, 10);

const shiftedInstant = (start: Instant, duration: OccurrenceDuration): Instant => {
  switch (duration.kind) {
    case "exact": {
      return {
        kind: "instant",
        value: new Date(Date.parse(start.value) + duration.seconds * millisecondsInSecond).toISOString(),
      };
    }
    case "nominal": {
      return {
        kind: "instant",
        value: new Date(Date.parse(start.value) + duration.days * dayMs).toISOString(),
      };
    }
    default: {
      return assertNever(duration);
    }
  }
};

const spanOfAnchor = (anchor: RecurrenceAnchor, zones: ZoneCache): SerializedSpan => {
  switch (anchor.kind) {
    case "allDay": {
      return {
        start: utcMidnight(anchor.startDate.value),
        end: utcMidnight(shiftedDate(anchor.startDate.value, anchor.duration.days)),
        isAllDay: true,
      };
    }
    case "timed": {
      return timedSpan(anchor.start, shiftedInstant(anchor.start, anchor.duration), anchor.zone, zones);
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const spanOf = (content: EditableContent, zones: ZoneCache): SerializedSpan => {
  if (content.recurrence === null) {
    return spanOfTime(content.time, zones);
  }
  return spanOfAnchor(content.anchor, zones);
};

const heldProperties = (existing: GraphEvent | null): ReadonlyMap<string, string> => {
  const held = new Map<string, string>();
  const carried = existing?.singleValueExtendedProperties;
  if (!Array.isArray(carried)) {
    return held;
  }
  for (const property of carried) {
    if (typeof property?.id === "string" && typeof property.value === "string") {
      held.set(property.id, property.value);
    }
  }
  return held;
};

const propertiesOf = (inputs: SerializeInputs): readonly SingleValueLegacyExtendedProperty[] => {
  const held = new Map(heldProperties(inputs.existing));
  if (inputs.provenance !== null) {
    held.set(provenancePropertyName, inputs.provenance.installation.value);
  }
  if (inputs.idempotencyKey !== null) {
    held.set(mirroredUidPropertyName, inputs.idempotencyKey);
  }
  const { recurrence } = inputs.content.content;
  held.delete(recurrencePropertyName);
  if (recurrence !== null) {
    held.set(
      recurrencePropertyName,
      JSON.stringify({
        dialect: recurrence.dialect,
        value: recurrence.value,
        exceptions: recurrence.exceptions,
      }),
    );
  }
  return [...held.entries()].map(([id, value]) => singleValueProperty(id, value));
};

const categoriesOf = (inputs: SerializeInputs): readonly string[] => {
  if (inputs.provenance !== null) {
    return [provenanceCategory];
  }
  const carried = inputs.existing?.categories;
  if (!Array.isArray(carried)) {
    return [];
  }
  return carried;
};

const serializeForGraph = (inputs: SerializeInputs): GraphEvent => {
  const { content } = inputs.content;
  const span = spanOf(content, inputs.zones);
  return {
    subject: content.title,
    body: {
      contentType: "text",
      content: withPreservedRegion(content.description ?? "", inputs.preservedBody),
    },
    location: { displayName: content.location ?? "" },
    showAs: showAsOf(content.availability),
    sensitivity: sensitivityOf(content.visibility),
    isAllDay: span.isAllDay,
    start: span.start,
    end: span.end,
    originalStartTimeZone: span.start.timeZone,
    originalEndTimeZone: span.end.timeZone,
    categories: [...categoriesOf(inputs)],
    singleValueExtendedProperties: [...propertiesOf(inputs)],
  };
};

export { serializeForGraph };
export type { SerializeInputs };
