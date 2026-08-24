import { formatIsoDate } from "@/utils/date";

const LINE_BREAK = "\r\n";
const MAX_LINE_OCTETS = 75;
const CONTINUATION_PREFIX = " ";
const PRODUCT_ID = "-//Keeper.sh//Keeper.sh ICS Generator//EN";
const DAY_IN_MILLISECONDS = 86_400_000;
const ISO_DATE_LENGTH = 10;

const DATE_ONLY_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const UNFOLD_PATTERN = /\r\n[ \t]|\n[ \t]|\r[ \t]/g;
const UNESCAPE_PATTERN = /\\([\\;,nN])/g;

function utf8Length(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function foldLine(line: string): string {
  const segments: string[] = [];
  let current = "";
  let octets = 0;

  for (const character of line) {
    const size = utf8Length(character);
    const limit = segments.length === 0
      ? MAX_LINE_OCTETS
      : MAX_LINE_OCTETS - CONTINUATION_PREFIX.length;

    if (octets + size > limit) {
      segments.push(current);
      current = "";
      octets = 0;
    }

    current += character;
    octets += size;
  }

  segments.push(current);
  return segments.join(`${LINE_BREAK}${CONTINUATION_PREFIX}`);
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function unescapeText(value: string): string {
  return value.replace(UNESCAPE_PATTERN, (_, character: string) =>
    character === "n" || character === "N" ? "\n" : character);
}

function formatUtcDateTime(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

function formatCompactDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

function shiftIsoDate(isoDate: string, days: number): string {
  const shifted = new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_IN_MILLISECONDS);
  return shifted.toISOString().slice(0, ISO_DATE_LENGTH);
}

function parseWallClock(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface IcsEventDraft {
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  start: string;
  end: string;
}

export interface IcsCalendarOptions {
  uid: string;
  stamp: Date;
}

export function validateIcsEventDraft(draft: IcsEventDraft): string[] {
  const errors: string[] = [];

  if (!draft.summary.trim()) {
    errors.push("Give the event a title.");
  }

  if (!draft.start) {
    errors.push(draft.allDay ? "Pick a start date." : "Pick a start date and time.");
  }

  if (!draft.end) {
    errors.push(draft.allDay ? "Pick an end date." : "Pick an end date and time.");
  }

  if (!draft.start || !draft.end) {
    return errors;
  }

  if (draft.allDay) {
    if (draft.end < draft.start) {
      errors.push("The end date cannot fall before the start date.");
    }
    return errors;
  }

  const start = parseWallClock(draft.start);
  const end = parseWallClock(draft.end);

  if (!start || !end) {
    errors.push("Enter the start and end as a date and a time.");
    return errors;
  }

  if (end.getTime() <= start.getTime()) {
    errors.push("The end time has to come after the start time.");
  }

  return errors;
}

function buildTimeProperties(draft: IcsEventDraft): string[] {
  if (draft.allDay) {
    return [
      `DTSTART;VALUE=DATE:${formatCompactDate(draft.start)}`,
      `DTEND;VALUE=DATE:${formatCompactDate(shiftIsoDate(draft.end, 1))}`,
    ];
  }

  const start = parseWallClock(draft.start);
  const end = parseWallClock(draft.end);

  if (!start || !end) {
    throw new Error(`buildIcsCalendar received an unparseable time range, ${JSON.stringify(draft)}`);
  }

  return [`DTSTART:${formatUtcDateTime(start)}`, `DTEND:${formatUtcDateTime(end)}`];
}

export function buildIcsCalendar(draft: IcsEventDraft, options: IcsCalendarOptions): string {
  const errors = validateIcsEventDraft(draft);
  if (errors.length > 0) {
    throw new Error(`buildIcsCalendar received an incomplete event, ${errors.join(" ")}`);
  }

  const description = draft.description.trim();
  const location = draft.location.trim();

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${options.uid}`,
    `DTSTAMP:${formatUtcDateTime(options.stamp)}`,
    ...buildTimeProperties(draft),
    `SUMMARY:${escapeText(draft.summary.trim())}`,
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldLine).join(LINE_BREAK)}${LINE_BREAK}`;
}

const FILE_NAME_FALLBACK = "event";
const FILE_NAME_MAX_LENGTH = 48;

export function icsFileName(summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FILE_NAME_MAX_LENGTH)
    .replace(/-+$/, "");

  return `${slug || FILE_NAME_FALLBACK}.ics`;
}

export interface IcsDateValue {
  raw: string;
  timeZoneId: string | null;
  isUtc: boolean;
  isDateOnly: boolean;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ParsedIcsEvent {
  uid: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  organizer: string | null;
  status: string | null;
  recurrenceRule: string | null;
  start: IcsDateValue | null;
  end: IcsDateValue | null;
}

export interface ParsedIcsFile {
  productId: string | null;
  version: string | null;
  calendarName: string | null;
  events: ParsedIcsEvent[];
  errors: string[];
}

interface ContentLine {
  name: string;
  parameters: Map<string, string>;
  value: string;
}

function splitUnquoted(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (const character of text) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === separator && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);
  return parts;
}

function parseContentLine(line: string): ContentLine | null {
  let index = 0;
  let quoted = false;

  for (; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === ":" && !quoted) break;
  }

  if (index >= line.length) return null;

  const [name, ...parameterParts] = splitUnquoted(line.slice(0, index), ";");
  const parameters = new Map<string, string>();

  for (const parameterPart of parameterParts) {
    const separatorIndex = parameterPart.indexOf("=");
    if (separatorIndex === -1) continue;
    parameters.set(
      parameterPart.slice(0, separatorIndex).toUpperCase(),
      parameterPart.slice(separatorIndex + 1),
    );
  }

  return { name: name.toUpperCase(), parameters, value: line.slice(index + 1) };
}

function parseDateValue(line: ContentLine): IcsDateValue | null {
  const timeZoneId = line.parameters.get("TZID") ?? null;
  const dateOnly = line.value.match(DATE_ONLY_PATTERN);

  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return {
      raw: line.value,
      timeZoneId,
      isUtc: false,
      isDateOnly: true,
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: 0,
      minute: 0,
      second: 0,
    };
  }

  const dateTime = line.value.match(DATE_TIME_PATTERN);
  if (!dateTime) return null;

  const [, year, month, day, hour, minute, second, zulu] = dateTime;
  return {
    raw: line.value,
    timeZoneId,
    isUtc: zulu === "Z",
    isDateOnly: false,
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function createEvent(): ParsedIcsEvent {
  return {
    uid: null,
    summary: null,
    description: null,
    location: null,
    organizer: null,
    status: null,
    recurrenceRule: null,
    start: null,
    end: null,
  };
}

function applyEventProperty(event: ParsedIcsEvent, line: ContentLine): void {
  switch (line.name) {
    case "UID":
      event.uid = line.value;
      return;
    case "SUMMARY":
      event.summary = unescapeText(line.value);
      return;
    case "DESCRIPTION":
      event.description = unescapeText(line.value);
      return;
    case "LOCATION":
      event.location = unescapeText(line.value);
      return;
    case "ORGANIZER":
      event.organizer = line.parameters.get("CN") ?? line.value.replace(/^mailto:/i, "");
      return;
    case "STATUS":
      event.status = line.value;
      return;
    case "RRULE":
      event.recurrenceRule = line.value;
      return;
    case "DTSTART":
      event.start = parseDateValue(line);
      return;
    case "DTEND":
      event.end = parseDateValue(line);
      return;
    default:
  }
}

export function parseIcsFile(text: string): ParsedIcsFile {
  const parsed: ParsedIcsFile = {
    productId: null,
    version: null,
    calendarName: null,
    events: [],
    errors: [],
  };

  const lines = text.replace(UNFOLD_PATTERN, "").split(/\r\n|\n|\r/);
  const components: string[] = [];
  let event: ParsedIcsEvent | null = null;
  let sawCalendar = false;

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    const line = parseContentLine(rawLine);
    if (!line) {
      parsed.errors.push(`Line without a property name or value: "${rawLine.trim()}"`);
      continue;
    }

    if (line.name === "BEGIN") {
      const component = line.value.toUpperCase();
      components.push(component);
      if (component === "VCALENDAR") sawCalendar = true;
      if (component === "VEVENT") event = createEvent();
      continue;
    }

    if (line.name === "END") {
      if (line.value.toUpperCase() === "VEVENT" && event) {
        parsed.events.push(event);
        event = null;
      }
      components.pop();
      continue;
    }

    if (event && components[components.length - 1] === "VEVENT") {
      applyEventProperty(event, line);
      continue;
    }

    if (event) continue;

    if (components[components.length - 1] !== "VCALENDAR") continue;

    if (line.name === "PRODID") parsed.productId = line.value;
    if (line.name === "VERSION") parsed.version = line.value;
    if (line.name === "X-WR-CALNAME") parsed.calendarName = unescapeText(line.value);
  }

  if (!sawCalendar) {
    parsed.errors = ["No BEGIN:VCALENDAR block was found, so this is not an ICS file."];
  }

  return parsed;
}

function padTimeUnit(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(value: { year: number; month: number; day: number }): string {
  return `${value.year}-${padTimeUnit(value.month)}-${padTimeUnit(value.day)}`;
}

export interface IcsDateFormatOptions {
  /**
   * A DTEND written as a date rather than a date-time is the non-inclusive end of
   * the event (RFC 5545 3.8.2.2), so the last day it actually covers is the day
   * before. Set this when formatting a DTEND, or a one-day event reads a day long.
   */
  exclusiveEnd?: boolean;
}

export function formatIcsDateValue(
  value: IcsDateValue,
  options: IcsDateFormatOptions = {},
): string {
  if (value.isDateOnly) {
    const isoDate = toIsoDate(value);
    const lastDay = options.exclusiveEnd ? shiftIsoDate(isoDate, -1) : isoDate;
    return `${formatIsoDate(lastDay)}, all day`;
  }

  if (value.isUtc) {
    const instant = new Date(Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
    ));
    const date = formatIsoDate([
      instant.getFullYear(),
      padTimeUnit(instant.getMonth() + 1),
      padTimeUnit(instant.getDate()),
    ].join("-"));
    return `${date} at ${padTimeUnit(instant.getHours())}:${padTimeUnit(instant.getMinutes())}, your time`;
  }

  const time = `${padTimeUnit(value.hour)}:${padTimeUnit(value.minute)}`;
  const zone = value.timeZoneId ? `, ${value.timeZoneId}` : ", no time zone";
  return `${formatIsoDate(toIsoDate(value))} at ${time}${zone}`;
}
