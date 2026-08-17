import type { calendar_v3 } from "@googleapis/calendar";
import type {
  Availability,
  EditableContent,
  EventTime,
  InstallationId,
  NormalizedContent,
  OccurrenceDuration,
  RecurrenceAnchor,
  RecurrencePayload,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { mirroredUidPropertyKey } from "../decode/identity";
import { provenancePropertyKey } from "../decode/provenance";

interface SerializedIdentity {
  readonly installation: InstallationId;
  readonly uid: string;
}

interface SerializedSpan {
  readonly start: calendar_v3.Schema$EventDateTime;
  readonly end: calendar_v3.Schema$EventDateTime;
}

const dayMs = 24 * 60 * 60 * 1000;

const transparencyOf = (availability: Availability): string => {
  switch (availability) {
    case "free": {
      return "transparent";
    }
    case "busy": {
      return "opaque";
    }
    default: {
      return assertNever(availability);
    }
  }
};

const zonedDateTime = (value: string, zone: string | null): calendar_v3.Schema$EventDateTime => {
  if (zone === null) {
    return { dateTime: value };
  }
  return { dateTime: value, timeZone: zone };
};

const spanOfTime = (time: EventTime): SerializedSpan => {
  switch (time.kind) {
    case "allDay": {
      return {
        start: { date: time.startDate.value },
        end: { date: time.endDateExclusive.value },
      };
    }
    case "timed": {
      const zone = time.zone?.value ?? null;
      return {
        start: zonedDateTime(time.start.value, zone),
        end: zonedDateTime(time.end.value, zone),
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

const shiftedDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * dayMs).toISOString().slice(0, 10);

const shiftedInstant = (start: string, duration: OccurrenceDuration): string => {
  switch (duration.kind) {
    case "exact": {
      return new Date(Date.parse(start) + duration.seconds * 1000).toISOString();
    }
    case "nominal": {
      return new Date(Date.parse(start) + duration.days * dayMs).toISOString();
    }
    default: {
      return assertNever(duration);
    }
  }
};

const spanOfAnchor = (anchor: RecurrenceAnchor): SerializedSpan => {
  switch (anchor.kind) {
    case "allDay": {
      return {
        start: { date: anchor.startDate.value },
        end: { date: shiftedDate(anchor.startDate.value, anchor.duration.days) },
      };
    }
    case "timed": {
      return {
        start: zonedDateTime(anchor.start.value, anchor.zone.value),
        end: zonedDateTime(shiftedInstant(anchor.start.value, anchor.duration), anchor.zone.value),
      };
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const contentLine = /^[A-Z-]+[:;]/;

const asRuleLine = (value: string): string => {
  if (contentLine.test(value)) {
    return value;
  }
  return `RRULE:${value}`;
};

const recurrenceLinesOf = (recurrence: RecurrencePayload): readonly string[] => [
  asRuleLine(recurrence.value),
  ...recurrence.exceptions,
];

const occurrenceFields = (content: EditableContent): calendar_v3.Schema$Event => {
  if (content.recurrence === null) {
    return { ...spanOfTime(content.time) };
  }
  return { ...spanOfAnchor(content.anchor), recurrence: [...recurrenceLinesOf(content.recurrence)] };
};

/*
 * Google's patch semantics leave an omitted field unchanged and overwrite an array field that is
 * present, so a series is demoted to a single occurrence only by sending an empty recurrence array.
 * https://developers.google.com/workspace/calendar/api/v3/reference/events/patch
 */
const patchedOccurrenceFields = (content: EditableContent): calendar_v3.Schema$Event => {
  if (content.recurrence === null) {
    return { ...spanOfTime(content.time), recurrence: [] };
  }
  return { ...spanOfAnchor(content.anchor), recurrence: [...recurrenceLinesOf(content.recurrence)] };
};

const describedFields = (content: NormalizedContent<"google">): calendar_v3.Schema$Event => ({
  summary: content.content.title,
  description: content.content.description,
  location: content.content.location,
  transparency: transparencyOf(content.content.availability),
  visibility: content.content.visibility,
});

const patchBodyOf = (content: NormalizedContent<"google">): calendar_v3.Schema$Event => ({
  ...describedFields(content),
  ...patchedOccurrenceFields(content.content),
});

const stampOf = (identity: SerializedIdentity | null): calendar_v3.Schema$Event => {
  if (identity === null) {
    return {};
  }
  return {
    extendedProperties: {
      private: {
        [provenancePropertyKey]: identity.installation.value,
        [mirroredUidPropertyKey]: identity.uid,
      },
    },
  };
};

const serializeEvent = (
  content: NormalizedContent<"google">,
  identity: SerializedIdentity | null,
): calendar_v3.Schema$Event => ({
  ...describedFields(content),
  status: "confirmed",
  ...stampOf(identity),
  ...occurrenceFields(content.content),
});

export { patchBodyOf, serializeEvent };
export type { SerializedIdentity };
