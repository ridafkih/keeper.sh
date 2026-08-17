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
import type { CanonicalValue } from "./canonical";
import { canonicalise } from "./canonical";

const microsoftFingerprintContract: FingerprintContract = {
  canonicalisation: "rfc8785",
  comparableFields: [
    "title",
    "description",
    "location",
    "availability",
    "visibility",
    "time",
    "recurrence",
  ],
};

const timeProjection = (time: EventTime): CanonicalValue => {
  switch (time.kind) {
    case "allDay": {
      return {
        kind: time.kind,
        startDate: time.startDate.value,
        endDateExclusive: time.endDateExclusive.value,
      };
    }
    case "timed": {
      return {
        kind: time.kind,
        start: time.start.value,
        end: time.end.value,
        zone: time.zone?.value ?? null,
      };
    }
    default: {
      return assertNever(time);
    }
  }
};

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

const anchorProjection = (anchor: RecurrenceAnchor): CanonicalValue => {
  switch (anchor.kind) {
    case "timed": {
      return {
        kind: anchor.kind,
        start: anchor.start.value,
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

const recurrenceProjection = (recurrence: RecurrencePayload): CanonicalValue => ({
  dialect: recurrence.dialect,
  value: recurrence.value,
  exceptions: recurrence.exceptions,
});

const occurrenceProjection = (content: EditableContent): CanonicalValue => {
  if (content.recurrence === null) {
    return { recurrence: null, time: timeProjection(content.time) };
  }
  return {
    recurrence: recurrenceProjection(content.recurrence),
    anchor: anchorProjection(content.anchor),
  };
};

const canonicalEncoding = (content: EditableContent): string =>
  canonicalise({
    described: {
      title: content.title,
      description: content.description,
      location: content.location,
      availability: content.availability,
      visibility: content.visibility,
    },
    occurrence: occurrenceProjection(content),
  });

const microsoftFingerprint = (
  content: EditableContent,
  hash: (input: string) => string,
): Fingerprint => ({ kind: "fingerprint", value: hash(canonicalEncoding(content)) });

export { canonicalEncoding, microsoftFingerprint, microsoftFingerprintContract };
