import { generateIcsTimezone } from "ts-ics";
import { buildVtimezone } from "./build-vtimezone";

const LINE_BREAK_PATTERN = /\r?\n/;
const FOLD_PATTERN = /\r?\n[\t ]/g;
const TZID_PARAMETER_PATTERN = /;TZID=("?)([^";:]+)\1(?=;|$)/i;
const CALENDAR_START_PATTERN = /^BEGIN:VCALENDAR\s*$/i;
const DATE_PREFIX_PATTERN = /^(\d{4})(\d{2})(\d{2})/;

interface TimeZoneUsage {
  definedIds: Set<string>;
  referenceInstantById: Map<string, Date>;
}

/*
 * The reference instant only selects which years buildVtimezone projects, so a
 * value read as if it were UTC is precise enough: it can never land more than a
 * day away from the real instant.
 */
const readReferenceInstant = (value: string): Date => {
  const match = DATE_PREFIX_PATTERN.exec(value);
  if (!match) {
    return new Date();
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
};

const collectTimeZoneUsage = (icsString: string): TimeZoneUsage => {
  const definedIds = new Set<string>();
  const referenceInstantById = new Map<string, Date>();
  let insideTimezone = false;

  for (const line of icsString.replaceAll(FOLD_PATTERN, "").split(LINE_BREAK_PATTERN)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const property = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1).trim();
    const propertyName = property.toUpperCase();

    if (propertyName === "BEGIN" && value.toUpperCase() === "VTIMEZONE") {
      insideTimezone = true;
      continue;
    }
    if (propertyName === "END" && value.toUpperCase() === "VTIMEZONE") {
      insideTimezone = false;
      continue;
    }
    if (insideTimezone) {
      if (propertyName === "TZID") {
        definedIds.add(value);
      }
      continue;
    }

    const timeZoneId = TZID_PARAMETER_PATTERN.exec(property)?.[2];
    if (!timeZoneId || referenceInstantById.has(timeZoneId)) {
      continue;
    }
    referenceInstantById.set(timeZoneId, readReferenceInstant(value));
  }

  return { definedIds, referenceInstantById };
};

const buildMissingTimezoneBlocks = (usage: TimeZoneUsage): string[] => {
  const blocks: string[] = [];
  for (const [timeZoneId, referenceInstant] of usage.referenceInstantById) {
    if (usage.definedIds.has(timeZoneId)) {
      continue;
    }
    const timezone = buildVtimezone(timeZoneId, referenceInstant);
    if (!timezone) {
      continue;
    }
    /*
     * The generated observances describe the IANA zone, but the block has to
     * keep the identifier the properties actually reference (a Windows name
     * like "Eastern Standard Time" included) or nothing links to it.
     */
    blocks.push(generateIcsTimezone({ ...timezone, id: timeZoneId }).trim());
  }
  return blocks;
};

/**
 * Adds a VTIMEZONE for every TZID a calendar references but never defines.
 *
 * Without one, ts-ics cannot resolve the identifier and falls back to reading
 * the wall-clock value as if it were the UTC instant, which lands on the wrong
 * side of every DST transition.
 */
const synthesizeMissingVtimezones = (icsString: string): string => {
  const usage = collectTimeZoneUsage(icsString);
  if (usage.referenceInstantById.size === 0) {
    return icsString;
  }
  const blocks = buildMissingTimezoneBlocks(usage);
  if (blocks.length === 0) {
    return icsString;
  }

  const lines = icsString.split(LINE_BREAK_PATTERN);
  const calendarStartIndex = lines.findIndex((line) => CALENDAR_START_PATTERN.test(line));
  if (calendarStartIndex === -1) {
    return icsString;
  }
  return [
    ...lines.slice(0, calendarStartIndex + 1),
    ...blocks,
    ...lines.slice(calendarStartIndex + 1),
  ].join("\r\n");
};

export { synthesizeMissingVtimezones };
