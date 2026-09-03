import type {
  EditableContent,
  EventTime,
  Fingerprint,
  FingerprintContract,
  OccurrenceDuration,
  RecurrenceAnchor,
  RecurrencePayload,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CanonicalValue, KeyOrder } from "../canonical";
import { canonicaliseWith, sortedKeys } from "../canonical";

const comparableFields = [
  "title",
  "description",
  "location",
  "availability",
  "visibility",
] as const;

type ComparableField = (typeof comparableFields)[number];

const referenceFingerprintContract: FingerprintContract = {
  canonicalisation: "rfc8785",
  comparableFields: [...comparableFields],
};

const isComparableField = (key: string): key is ComparableField =>
  comparableFields.some((field) => field === key);

const comparableValueOf = (
  content: EditableContent,
  field: ComparableField,
): CanonicalValue => {
  switch (field) {
    case "title": {
      return content.title;
    }
    case "description": {
      return content.description;
    }
    case "location": {
      return content.location;
    }
    case "availability": {
      return content.availability;
    }
    case "visibility": {
      return content.visibility;
    }
    default: {
      return assertNever(field);
    }
  }
};

const wholeSeconds = (value: string): string =>
  new Date(Math.floor(Date.parse(value) / 1000) * 1000).toISOString();

const identityText = (value: string, normalise: boolean): string => {
  if (!normalise) {
    return value;
  }
  return value.replaceAll("\r\n", "\n").trimEnd();
};

const identityInstant = (value: string, normalise: boolean): string => {
  if (!normalise) {
    return value;
  }
  return wholeSeconds(value);
};

const timeProjection = (time: EventTime, normalise: boolean): CanonicalValue => {
  if (time.kind === "allDay") {
    return {
      kind: time.kind,
      startDate: time.startDate.value,
      endDateExclusive: time.endDateExclusive.value,
    };
  }
  return {
    kind: time.kind,
    start: identityInstant(time.start.value, normalise),
    end: identityInstant(time.end.value, normalise),
    zone: time.zone?.value ?? null,
  };
};

const recurrenceProjection = (recurrence: RecurrencePayload): CanonicalValue => ({
  dialect: recurrence.dialect,
  value: recurrence.value,
  exceptions: recurrence.exceptions,
});

const durationProjection = (duration: OccurrenceDuration): CanonicalValue => {
  switch (duration.kind) {
    case "exact": {
      return { kind: duration.kind, seconds: duration.seconds };
    }
    case "nominal": {
      return { kind: duration.kind, days: duration.days };
    }
    default: {
      return assertNever(duration);
    }
  }
};

const anchorProjection = (anchor: RecurrenceAnchor, normalise: boolean): CanonicalValue => {
  switch (anchor.kind) {
    case "timed": {
      return {
        kind: anchor.kind,
        start: identityInstant(anchor.start.value, normalise),
        zone: anchor.zone.value,
        duration: durationProjection(anchor.duration),
      };
    }
    case "allDay": {
      return {
        kind: anchor.kind,
        startDate: anchor.startDate.value,
        duration: durationProjection(anchor.duration),
      };
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const normalisedValue = (value: CanonicalValue, normalise: boolean): CanonicalValue => {
  if (typeof value !== "string") {
    return value;
  }
  return identityText(value, normalise);
};

const describedProjection = (
  content: EditableContent,
  normalise: boolean,
): Record<string, CanonicalValue> => {
  const projection: Record<string, CanonicalValue> = {};
  for (const key of Object.keys(content)) {
    if (isComparableField(key)) {
      projection[key] = normalisedValue(comparableValueOf(content, key), normalise);
    }
  }
  return projection;
};

const contentProjection = (content: EditableContent, normalise: boolean): CanonicalValue => {
  const described = describedProjection(content, normalise);
  if (content.recurrence === null) {
    return { ...described, time: timeProjection(content.time, normalise) };
  }
  return {
    ...described,
    recurrence: recurrenceProjection(content.recurrence),
    anchor: anchorProjection(content.anchor, normalise),
  };
};

const encodeIdentity = (
  order: KeyOrder,
  normalise: boolean,
  content: EditableContent,
): string =>
  `reference-fingerprint:${canonicaliseWith(order, contentProjection(content, normalise))}`;

const fingerprintWith = (
  order: KeyOrder,
  content: EditableContent,
  hash: (input: string) => string,
): Fingerprint => ({
  kind: "fingerprint",
  value: hash(encodeIdentity(order, true, content)),
});

const fingerprintOf = (
  content: EditableContent,
  hash: (input: string) => string,
): Fingerprint => fingerprintWith(sortedKeys, content, hash);

export { encodeIdentity, fingerprintOf, fingerprintWith, referenceFingerprintContract };
