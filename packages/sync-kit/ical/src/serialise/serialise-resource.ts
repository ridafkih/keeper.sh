import type {
  CalendarDate,
  EditableContent,
  EventUid,
  Instant,
  OccurrenceDuration,
  RecurrenceAnchor,
  RepresentabilityConstraint,
  ZoneId,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CanonicalEvent } from "../canonical/canonical-event";
import type { IcsOptions } from "../options";
import { buildVtimezone } from "../zone/build-vtimezone";
import { normalizeZoneIdentifier } from "../zone/normalize-zone-id";
import { contentLineBreak, foldContentLine } from "../text/fold";
import { provenanceStamp } from "../parse/self-authored";
import { escapeTextValue } from "./escape";
import { renderZonedDate, utcText } from "./zoned-date";

interface RecurrenceSet {
  readonly master: CanonicalEvent;
  readonly overrides: readonly CanonicalEvent[];
  readonly sequence: number;
}

type SerialisedResource =
  | { readonly kind: "resource"; readonly text: string; readonly zones: readonly ZoneId[] }
  | { readonly kind: "refused"; readonly constraint: RepresentabilityConstraint }
  | { readonly kind: "uidMismatch"; readonly master: EventUid; readonly override: EventUid };

const millisecondsInSecond = 1000;
const millisecondsInDay = 24 * 60 * 60 * millisecondsInSecond;

const dateText = (date: CalendarDate): string => date.value.replaceAll("-", "");

const shiftedDateText = (date: CalendarDate, days: number): string => {
  const shifted = new Date(Date.parse(`${date.value}T00:00:00.000Z`) + days * millisecondsInDay);
  return shifted.toISOString().slice(0, 10).replaceAll("-", "");
};

const zonesOfContent = (content: EditableContent): readonly ZoneId[] => {
  if (content.recurrence && content.anchor && content.anchor.kind === "timed") {
    return [content.anchor.zone];
  }
  if (content.time && content.time.kind === "timed" && content.time.zone) {
    return [content.time.zone];
  }
  return [];
};

const describedLines = (content: EditableContent): readonly string[] => {
  const lines = [`SUMMARY:${escapeTextValue(content.title)}`];
  if (content.description !== null) {
    lines.push(`DESCRIPTION:${escapeTextValue(content.description)}`);
  }
  if (content.location !== null) {
    lines.push(`LOCATION:${escapeTextValue(content.location)}`);
  }
  if (content.availability === "free") {
    lines.push("TRANSP:TRANSPARENT");
  }
  if (content.visibility === "private") {
    lines.push("CLASS:PRIVATE");
  }
  if (content.visibility === "public") {
    lines.push("CLASS:PUBLIC");
  }
  return lines;
};

const timedLines = (
  name: string,
  instant: Instant,
  zone: ZoneId | null,
  options: IcsOptions,
): readonly string[] => {
  if (!zone) {
    return [`${name}:${utcText(instant)}`];
  }
  return [renderZonedDate(name, instant, zone, options.zones).text];
};

const durationMilliseconds = (duration: OccurrenceDuration): number => {
  switch (duration.kind) {
    case "exact": {
      return duration.seconds * millisecondsInSecond;
    }
    case "nominal": {
      return duration.days * millisecondsInDay;
    }
    default: {
      return assertNever(duration);
    }
  }
};

const singleOccurrenceLines = (content: EditableContent, options: IcsOptions): readonly string[] => {
  const { time } = content;
  if (!time) {
    return [];
  }
  switch (time.kind) {
    case "timed": {
      return [
        ...timedLines("DTSTART", time.start, time.zone, options),
        ...timedLines("DTEND", time.end, time.zone, options),
      ];
    }
    case "allDay": {
      return [
        `DTSTART;VALUE=DATE:${dateText(time.startDate)}`,
        `DTEND;VALUE=DATE:${dateText(time.endDateExclusive)}`,
      ];
    }
    default: {
      return assertNever(time);
    }
  }
};

const utcDateOf = (value: string): string => value.slice(0, 8);

const exceptionLines = (
  exceptions: readonly string[],
  anchor: RecurrenceAnchor,
): readonly string[] => {
  switch (anchor.kind) {
    case "timed": {
      return exceptions.map((value) => `EXDATE:${value}`);
    }
    case "allDay": {
      return exceptions.map((value) => `EXDATE;VALUE=DATE:${utcDateOf(value)}`);
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const recurringLines = (content: EditableContent, options: IcsOptions): readonly string[] => {
  const { anchor, recurrence } = content;
  if (!anchor || !recurrence) {
    return [];
  }
  const rule = [`RRULE:${recurrence.value}`];
  const exceptions = exceptionLines(recurrence.exceptions, anchor);
  switch (anchor.kind) {
    case "timed": {
      const endMs = Date.parse(anchor.start.value) + durationMilliseconds(anchor.duration);
      return [
        ...timedLines("DTSTART", anchor.start, anchor.zone, options),
        ...timedLines("DTEND", { kind: "instant", value: new Date(endMs).toISOString() }, anchor.zone, options),
        ...rule,
        ...exceptions,
      ];
    }
    case "allDay": {
      return [
        `DTSTART;VALUE=DATE:${dateText(anchor.startDate)}`,
        `DTEND;VALUE=DATE:${shiftedDateText(anchor.startDate, anchor.duration.days)}`,
        ...rule,
        ...exceptions,
      ];
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const recurrenceIdLine = (event: CanonicalEvent, options: IcsOptions): readonly string[] => {
  if (event.identity.kind !== "override") {
    return [];
  }
  return timedLines("RECURRENCE-ID", event.identity.recurrenceInstant, null, options);
};

const eventLines = (
  event: CanonicalEvent,
  uid: EventUid,
  sequence: number,
  options: IcsOptions,
): readonly string[] => [
  "BEGIN:VEVENT",
  `UID:${uid.value}`,
  "DTSTAMP:19700101T000000Z",
  `SEQUENCE:${sequence}`,
  `${provenanceStamp}:${options.installation.value}`,
  ...recurrenceIdLine(event, options),
  ...describedLines(event.content),
  ...singleOccurrenceLines(event.content, options),
  ...recurringLines(event.content, options),
  "END:VEVENT",
];

const invertedRange = (content: EditableContent): boolean => {
  const { time } = content;
  if (!time || time.kind !== "timed") {
    return false;
  }
  return Date.parse(time.end.value) < Date.parse(time.start.value);
};

const mismatchedOverride = (set: RecurrenceSet): CanonicalEvent | undefined =>
  set.overrides.find((override) => override.identity.uid.value !== set.master.identity.uid.value);

const uniqueZones = (set: RecurrenceSet): readonly ZoneId[] => {
  const all = [set.master, ...set.overrides].flatMap((event) => [...zonesOfContent(event.content)]);
  const seen = new Set<string>();
  return all.filter((zone) => {
    if (seen.has(zone.value)) {
      return false;
    }
    seen.add(zone.value);
    return true;
  });
};

const startOfDay = (date: CalendarDate): Instant => ({
  kind: "instant",
  value: `${date.value}T00:00:00.000Z`,
});

const anchorStartOf = (anchor: RecurrenceAnchor): Instant => {
  switch (anchor.kind) {
    case "timed": {
      return anchor.start;
    }
    case "allDay": {
      return startOfDay(anchor.startDate);
    }
    default: {
      return assertNever(anchor);
    }
  }
};

const startInstantOf = (content: EditableContent): Instant => {
  if (!content.time) {
    return anchorStartOf(content.anchor);
  }
  switch (content.time.kind) {
    case "timed": {
      return content.time.start;
    }
    case "allDay": {
      return startOfDay(content.time.startDate);
    }
    default: {
      return assertNever(content.time);
    }
  }
};

const referenceYearOf = (set: RecurrenceSet): number => {
  const starts = [set.master, ...set.overrides].map((event) =>
    Date.parse(startInstantOf(event.content).value),
  );
  return new Date(Math.min(...starts)).getUTCFullYear();
};

const normalisedZone = (zone: ZoneId): ZoneId | null => {
  const normalised = normalizeZoneIdentifier(zone.value);
  if (!normalised) {
    return null;
  }
  return { kind: "zoneId", value: normalised };
};

const normalisedTime = (content: EditableContent): EditableContent | null => {
  if (!content.time || content.time.kind !== "timed" || !content.time.zone) {
    return content;
  }
  const zone = normalisedZone(content.time.zone);
  if (!zone) {
    return null;
  }
  return { ...content, time: { ...content.time, zone } };
};

const normalisedContent = (content: EditableContent): EditableContent | null => {
  if (!content.recurrence || !content.anchor || content.anchor.kind !== "timed") {
    return normalisedTime(content);
  }
  const zone = normalisedZone(content.anchor.zone);
  if (!zone) {
    return null;
  }
  return { ...content, anchor: { ...content.anchor, zone } };
};

const normalisedEvents = (set: RecurrenceSet): RecurrenceSet | null => {
  const master = normalisedContent(set.master.content);
  if (!master) {
    return null;
  }
  const overrides: CanonicalEvent[] = [];
  for (const override of set.overrides) {
    const content = normalisedContent(override.content);
    if (!content) {
      return null;
    }
    overrides.push({ ...override, content });
  }
  return { ...set, master: { ...set.master, content: master }, overrides };
};

const foldedLines = (lines: readonly string[]): readonly string[] =>
  lines.flatMap((line) => [...foldContentLine(line)]);

const foldedText = (lines: readonly string[]): string =>
  foldedLines(lines)
    .map((line) => `${line}${contentLineBreak}`)
    .join("");

const zoneBlockLines = (
  zones: readonly ZoneId[],
  referenceYear: number,
  options: IcsOptions,
): readonly string[] | null => {
  const lines: string[] = [];
  for (const zone of zones) {
    const block = buildVtimezone(zone, referenceYear, options);
    if (block.kind === "unresolvableZone") {
      return null;
    }
    lines.push(...block.text.split(contentLineBreak));
  }
  return lines;
};

const serialiseCalendarResource = (set: RecurrenceSet, options: IcsOptions): SerialisedResource => {
  const mismatch = mismatchedOverride(set);
  if (mismatch) {
    return {
      kind: "uidMismatch",
      master: set.master.identity.uid,
      override: mismatch.identity.uid,
    };
  }
  if ([set.master, ...set.overrides].some((event) => invertedRange(event.content))) {
    return { kind: "refused", constraint: "invertedRange" };
  }
  const normalised = normalisedEvents(set);
  if (!normalised) {
    return { kind: "refused", constraint: "zoneIdentifier" };
  }
  const referenceYear = referenceYearOf(normalised);
  const { uid } = normalised.master.identity;
  const zones = uniqueZones(normalised);
  const zoneLines = zoneBlockLines(zones, referenceYear, options);
  if (!zoneLines) {
    return { kind: "refused", constraint: "zoneIdentifier" };
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//keeper.sh//sync-ical//EN",
    ...zoneLines,
    ...eventLines(normalised.master, uid, set.sequence, options),
    ...normalised.overrides.flatMap((override) => [
      ...eventLines(override, uid, set.sequence, options),
    ]),
    "END:VCALENDAR",
  ];
  return { kind: "resource", text: foldedText(lines), zones };
};

export { serialiseCalendarResource };
export type { RecurrenceSet, SerialisedResource };
