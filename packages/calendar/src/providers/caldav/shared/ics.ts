import { generateIcsCalendar } from "ts-ics";
import { parseIcsCalendar, buildZonedIcsDate } from "../../../ics";
import type { IcsDuration, IcsEvent } from "ts-ics";
import type { SyncableEvent } from "../../../core/types";
import { isKeeperEvent } from "../../../core/events/identity";
import { resolveIsAllDayEvent } from "../../../core/events/all-day";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  MS_PER_WEEK,
} from "@keeper.sh/constants";

const DEFAULT_DURATION_VALUE = 0;

const durationToMs = (duration: IcsDuration): number => {
  const {
    weeks = DEFAULT_DURATION_VALUE,
    days = DEFAULT_DURATION_VALUE,
    hours = DEFAULT_DURATION_VALUE,
    minutes = DEFAULT_DURATION_VALUE,
    seconds = DEFAULT_DURATION_VALUE,
  } = duration;

  return (
    weeks * MS_PER_WEEK
    + days * MS_PER_DAY
    + hours * MS_PER_HOUR
    + minutes * MS_PER_MINUTE
    + seconds * MS_PER_SECOND
  );
};

const getEventEndTime = (event: IcsEvent, startTime: Date): Date => {
  if ("end" in event && event.end) {
    return event.end.date;
  }

  if ("duration" in event && event.duration) {
    return new Date(startTime.getTime() + durationToMs(event.duration));
  }

  return startTime;
};

const HTML_TAG_PATTERN = /<[^>]*>/g;
const HTML_ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
};
const ANCHOR_PATTERN = /<a\b[^>]*?href="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi;
const ICS_LINE_MAX_OCTETS = 75;

const isHtmlDescription = (text: string): boolean => /<\/?\w+[^>]*>/.test(text);

const htmlToPlainText = (html: string): string => {
  const withAnchorsConverted = html.replace(ANCHOR_PATTERN, (_match, href: string, text: string) => {
    const plainText = text.replaceAll(HTML_TAG_PATTERN, "").replaceAll(/[\r\n\t ]+/g, " ").trim();
    if (!plainText || plainText === href) {
      return href;
    }
    return `${plainText} (${href})`;
  });
  const withoutTags = withAnchorsConverted.replaceAll(HTML_TAG_PATTERN, "");
  const decoded = withoutTags.replaceAll(
    /&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
    (entity) => HTML_ENTITIES[entity] ?? entity,
  );
  return decoded.replaceAll(/[\r\n\t ]+/g, " ").trim();
};

const foldIcsLine = (line: string): string => {
  if (Buffer.byteLength(line, "utf8") <= ICS_LINE_MAX_OCTETS) {
    return line;
  }
  const parts: string[] = [];
  let remaining = line;
  while (Buffer.byteLength(remaining, "utf8") > ICS_LINE_MAX_OCTETS) {
    let cut = ICS_LINE_MAX_OCTETS;
    while (cut > 0 && Buffer.byteLength(remaining.slice(0, cut), "utf8") > ICS_LINE_MAX_OCTETS) {
      cut--;
    }
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut);
  }
  parts.push(remaining);
  return parts.join("\r\n ");
};

const eventToICalString = (event: SyncableEvent, uid: string): string => {
  const isAllDay = resolveIsAllDayEvent(event);

  const rawDescription = event.description;
  const descriptionIsHtml = Boolean(rawDescription) && isHtmlDescription(rawDescription ?? "");
  let plainDescription = rawDescription;
  if (descriptionIsHtml && rawDescription) {
    plainDescription = htmlToPlainText(rawDescription);
  }

  const icsEvent: IcsEvent = {
    description: plainDescription,
    end: buildZonedIcsDate(event.endTime, event.startTimeZone, isAllDay),
    location: event.location,
    stamp: { date: new Date() },
    start: buildZonedIcsDate(event.startTime, event.startTimeZone, isAllDay),
    summary: event.summary,
    ...(event.availability === "free" && { timeTransparent: "TRANSPARENT" }),
    uid,
  };

  const baseIcs = generateIcsCalendar({
    events: [icsEvent],
    prodId: "-//Keeper//Keeper Calendar//EN",
    version: "2.0",
  });

  if (!descriptionIsHtml || !rawDescription) {
    return baseIcs;
  }

  // Inject X-ALT-DESC with the original HTML before END:VEVENT for clients that support rich descriptions.
  const escapedHtml = rawDescription
    .replaceAll("\\", String.raw`\\`)
    .replaceAll(";", String.raw`\;`)
    .replaceAll(",", String.raw`\,`)
    .replaceAll(/\r?\n/g, String.raw`\n`);
  const altDescLine = `X-ALT-DESC;FMTTYPE=text/html:${escapedHtml}`;
  const folded = foldIcsLine(altDescLine);
  return baseIcs.replace(/END:VEVENT\r\n/, `${folded}\r\nEND:VEVENT\r\n`);
};

interface ParsedCalendarEvent {
  availability?: SyncableEvent["availability"];
  deleteId: string;
  endTime: Date;
  isKeeperEvent: boolean;
  isAllDay?: boolean;
  startTime: Date;
  uid: string;
  title?: string;
  description?: string;
  location?: string;
  startTimeZone?: string;
  recurrenceRule?: object;
  exceptionDates?: object;
  recurrenceId?: Date;
}

const mapAvailability = (transparency: "TRANSPARENT" | "OPAQUE" | undefined) => {
  if (transparency === "TRANSPARENT") {
    return "free";
  }
  return "busy";
};

const mapIcsEventToParsedEvent = (event: IcsEvent): ParsedCalendarEvent | null => {
  if (!event.uid || !event.start?.date) {
    return null;
  }

  const startTime = event.start.date;
  const endTime = getEventEndTime(event, startTime);

  return {
    availability: mapAvailability(event.timeTransparent),
    deleteId: event.uid,
    description: event.description,
    endTime,
    exceptionDates: event.exceptionDates,
    recurrenceId: event.recurrenceId?.value?.date,
    isKeeperEvent: isKeeperEvent(event.uid),
    isAllDay: event.start.type === "DATE",
    location: event.location,
    recurrenceRule: event.recurrenceRule,
    startTime,
    startTimeZone: event.start.local?.timezone,
    title: event.summary,
    uid: event.uid,
  };
};

const parseICalToRemoteEvents = (icsString: string): ParsedCalendarEvent[] => {
  const calendar = parseIcsCalendar({ icsString });
  const events = calendar.events ?? [];
  const parsed: ParsedCalendarEvent[] = [];

  for (const event of events) {
    const result = mapIcsEventToParsedEvent(event);
    if (result) {
      parsed.push(result);
    }
  }

  return parsed;
};

const parseICalToRemoteEvent = (icsString: string): ParsedCalendarEvent | null => {
  const [event] = parseICalToRemoteEvents(icsString);
  return event ?? null;
};

export { eventToICalString, parseICalToRemoteEvent, parseICalToRemoteEvents };
