import { convertIcsCalendar } from "ts-ics";

interface ParseIcsCalendarOptions {
  icsString: string;
}

const VTIMEZONE_BLOCK_PATTERN = /BEGIN:VTIMEZONE\r?\n([\s\S]*?)END:VTIMEZONE\r?\n?/g;
const TZID_LINE_PATTERN = /(?:^|\r?\n)TZID:(.+?)(?:\r?\n|$)/;

const isIanaTimezone = (tzid: string): boolean => {
  try {
    // Throws RangeError for non-IANA values (including Windows zone names like
    // "Eastern Standard Time"). The runtime falls back to a static lookup, so
    // this is O(1) — no need to memoize.
    new Intl.DateTimeFormat("en", { timeZone: tzid });
    return true;
  } catch {
    return false;
  }
};

/**
 * iCloud (and some other CalDAV servers) embed a VTIMEZONE block that lists
 * historical DST transitions but truncates future rules at the year the zone
 * was last updated. For zones like America/Montevideo — which abolished DST in
 * 2015 — the embedded VTIMEZONE has no rules after 2015, and ts-ics extrapolates
 * the last DAYLIGHT rule forward indefinitely, producing UTC offsets that are
 * off by one hour for any date after the last rule.
 *
 * When the TZID matches a runtime-recognized IANA zone, we strip the VTIMEZONE
 * block so ts-ics falls back to the platform's IANA tzdata (Node/Bun's ICU),
 * which has correct post-2015 rules. Non-IANA TZIDs (Microsoft Windows zone
 * names like "Eastern Standard Time", custom zones, etc.) are left untouched
 * because the embedded VTIMEZONE is the only way to resolve them.
 */
const stripIanaVTimezones = (icsString: string): string =>
  icsString.replace(VTIMEZONE_BLOCK_PATTERN, (match, body: string) => {
    const tzidMatch = body.match(TZID_LINE_PATTERN);
    const tzid = tzidMatch?.[1]?.trim();
    if (tzid && isIanaTimezone(tzid)) {
      return "";
    }
    return match;
  });

const parseIcsCalendar = (options: ParseIcsCalendarOptions) =>
  convertIcsCalendar(globalThis.undefined, stripIanaVTimezones(options.icsString));

export { parseIcsCalendar, stripIanaVTimezones };
