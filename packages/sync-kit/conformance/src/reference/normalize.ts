import type {
  EditableContent,
  EventTime,
  NormalizedContent,
  RecurrenceAnchor,
  RepresentabilityConstraint,
  Result,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { referenceMinimumSpanSeconds } from "./capabilities";
import { fingerprintOf } from "./fingerprint";

const wholeSeconds = (value: string): string =>
  new Date(Math.floor(Date.parse(value) / 1000) * 1000).toISOString();

const tidy = (value: string): string => value.replaceAll("\r\n", "\n").trimEnd();

const tidyOptional = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  return tidy(value);
};

const widenedEnd = (start: string, end: string): string => {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (endMs - startMs >= referenceMinimumSpanSeconds * 1000) {
    return end;
  }
  return new Date(startMs + referenceMinimumSpanSeconds * 1000).toISOString();
};

const rewriteTime = (time: EventTime): EventTime => {
  if (time.kind === "allDay") {
    return time;
  }
  const start = wholeSeconds(time.start.value);
  return {
    kind: "timed",
    start: { kind: "instant", value: start },
    end: { kind: "instant", value: widenedEnd(start, wholeSeconds(time.end.value)) },
    zone: time.zone,
  };
};

const rewriteAsProviderWould = (content: EditableContent): EditableContent => {
  const described = {
    title: tidy(content.title),
    description: tidyOptional(content.description),
    location: tidyOptional(content.location),
    availability: content.availability,
    visibility: content.visibility,
  };
  if (content.recurrence === null) {
    return { ...described, recurrence: null, time: rewriteTime(content.time) };
  }
  return { ...described, recurrence: content.recurrence, anchor: content.anchor };
};

const isResolvableZone = (zone: ZoneId): boolean => {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone.value }).resolvedOptions()
      .timeZone.length > 0;
  } catch {
    return false;
  }
};

const anchorZoneViolation = (anchor: RecurrenceAnchor): RepresentabilityConstraint | null => {
  if (anchor.kind === "allDay") {
    return null;
  }
  if (isResolvableZone(anchor.zone)) {
    return null;
  }
  return "zoneIdentifier";
};

const constraintViolatedBy = (
  content: EditableContent,
): RepresentabilityConstraint | null => {
  if (content.recurrence !== null) {
    if (content.recurrence.dialect !== "rfc5545") {
      return "recurrenceDialect";
    }
    return anchorZoneViolation(content.anchor);
  }
  if (content.time.kind === "allDay") {
    return null;
  }
  if (content.time.zone !== null && !isResolvableZone(content.time.zone)) {
    return "zoneIdentifier";
  }
  if (Date.parse(content.time.end.value) < Date.parse(content.time.start.value)) {
    return "invertedRange";
  }
  return null;
};

const normalizeForReference = (
  content: EditableContent,
  hash: (input: string) => string,
): Result<NormalizedContent<"reference">> => {
  const constraint = constraintViolatedBy(content);
  if (constraint !== null) {
    return { ok: false, failure: { kind: "unrepresentable", constraint } };
  }
  const rewritten = rewriteAsProviderWould(content);
  return {
    ok: true,
    value: {
      kind: "normalized",
      provider: "reference",
      content: rewritten,
      fingerprint: fingerprintOf(rewritten, hash),
    },
  };
};

export { constraintViolatedBy, isResolvableZone, normalizeForReference, rewriteAsProviderWould };
