import type { EditableContent, Fingerprint, FingerprintContract } from "@keeper.sh/sync-protocol";
import { compareCodeUnits } from "./canonical";

const caldavFingerprintContract: FingerprintContract = {
  canonicalisation: "rfc8785",
  comparableFields: ["title", "description", "location", "availability", "visibility", "recurrence"],
};

type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const encodeCanonical = (value: CanonicalValue): string => {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => encodeCanonical(entry)).join(",")}]`;
  }
  const entries = Object.entries(value).toSorted(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encodeCanonical(entry)}`).join(",")}}`;
};

const timeOf = (content: EditableContent): CanonicalValue => {
  if (content.recurrence !== null) {
    return { kind: "recurring" };
  }
  if (content.time.kind === "allDay") {
    return {
      kind: "allDay",
      startDate: content.time.startDate.value,
      endDateExclusive: content.time.endDateExclusive.value,
    };
  }
  return {
    kind: "timed",
    start: content.time.start.value,
    end: content.time.end.value,
    zone: content.time.zone?.value ?? null,
  };
};

const anchorOf = (content: EditableContent): CanonicalValue => {
  if (content.recurrence === null || !content.anchor) {
    return null;
  }
  if (content.anchor.kind === "allDay") {
    return {
      kind: "allDay",
      startDate: content.anchor.startDate.value,
      days: content.anchor.duration.days,
    };
  }
  return {
    kind: "timed",
    start: content.anchor.start.value,
    zone: content.anchor.zone.value,
    duration: content.anchor.duration,
  };
};

const recurrenceOf = (content: EditableContent): CanonicalValue => {
  if (content.recurrence === null) {
    return null;
  }
  return {
    dialect: content.recurrence.dialect,
    value: content.recurrence.value,
    exceptions: [...content.recurrence.exceptions].toSorted(),
  };
};

const canonicalContent = (content: EditableContent): CanonicalValue => ({
  title: content.title,
  description: content.description,
  location: content.location,
  availability: content.availability,
  visibility: content.visibility,
  time: timeOf(content),
  recurrence: recurrenceOf(content),
  anchor: anchorOf(content),
});

const caldavFingerprint = (
  content: EditableContent,
  hash: (input: string) => string,
): Fingerprint => ({
  kind: "fingerprint",
  value: hash(encodeCanonical(canonicalContent(content))),
});

export { caldavFingerprint, caldavFingerprintContract };
