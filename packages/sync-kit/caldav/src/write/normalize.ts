import type {
  EditableContent,
  NormalizedContent,
  RepresentabilityConstraint,
  Result,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { isIanaAuthoritative } from "@keeper.sh/sync-ical";
import { caldavCapabilities } from "../capabilities";
import type { CalDAVDependencies } from "../dependencies";
import { caldavFingerprint } from "../fingerprint";

const millisecondsInSecond = 1000;

const canonicalText = (value: string): string => value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");

const canonicalOptionalText = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }
  return canonicalText(value);
};

const shapedContent = (content: EditableContent): EditableContent => {
  const described = {
    title: canonicalText(content.title),
    description: canonicalOptionalText(content.description),
    location: canonicalOptionalText(content.location),
    availability: content.availability,
    visibility: content.visibility,
  };
  if (content.recurrence !== null) {
    return { ...described, recurrence: content.recurrence, anchor: content.anchor };
  }
  return { ...described, recurrence: null, time: content.time };
};

const timedConstraint = (
  startMs: number,
  endMs: number,
): RepresentabilityConstraint | null => {
  if (endMs < startMs) {
    return "invertedRange";
  }
  const span = (endMs - startMs) / millisecondsInSecond;
  if (span < caldavCapabilities.representableRange.minimumSpanSeconds) {
    return "minimumSpan";
  }
  return null;
};

const zoneConstraint = (zone: ZoneId | null): RepresentabilityConstraint | null => {
  if (zone === null) {
    return null;
  }
  if (isIanaAuthoritative(null, zone)) {
    return null;
  }
  return "zoneIdentifier";
};

const constraintViolatedBy = (content: EditableContent): RepresentabilityConstraint | null => {
  if (content.recurrence !== null) {
    if (content.recurrence.dialect !== "rfc5545") {
      return "recurrenceDialect";
    }
    if (content.anchor.kind === "timed") {
      const zone = zoneConstraint(content.anchor.zone);
      if (zone !== null) {
        return zone;
      }
    }
  }
  if (content.recurrence === null && content.time.kind === "timed") {
    const zone = zoneConstraint(content.time.zone);
    if (zone !== null) {
      return zone;
    }
  }
  if (content.recurrence !== null) {
    if (content.anchor.kind === "timed" && content.anchor.duration.kind === "exact") {
      return timedConstraint(0, content.anchor.duration.seconds * millisecondsInSecond);
    }
    return null;
  }
  if (content.time.kind === "allDay") {
    return timedConstraint(
      Date.parse(`${content.time.startDate.value}T00:00:00.000Z`),
      Date.parse(`${content.time.endDateExclusive.value}T00:00:00.000Z`),
    );
  }
  return timedConstraint(
    Date.parse(content.time.start.value),
    Date.parse(content.time.end.value),
  );
};

const normalizeCalDAVContent = (
  dependencies: CalDAVDependencies,
  content: EditableContent,
): Result<NormalizedContent<"caldav">> => {
  const constraint = constraintViolatedBy(content);
  if (constraint !== null) {
    return { ok: false, failure: { kind: "unrepresentable", constraint } };
  }
  const shaped = shapedContent(content);
  return {
    ok: true,
    value: {
      kind: "normalized",
      provider: "caldav",
      content: shaped,
      fingerprint: caldavFingerprint(shaped, dependencies.hash),
    },
  };
};

export { constraintViolatedBy, normalizeCalDAVContent, shapedContent };
