import type {
  AccountId,
  CalendarId,
  CalendarKey,
  Instant,
  ListingScope,
  TimeWindow,
} from "@keeper.sh/sync-protocol";

const testAccount: AccountId = { kind: "accountId", value: "acct-1" };
const testCalendarId: CalendarId = { kind: "calendarId", value: "cal-1" };

const testCalendar: CalendarKey = {
  provider: "ics",
  account: testAccount,
  calendar: testCalendarId,
};

const instant = (value: string): Instant => ({ kind: "instant", value });

const testWindow: TimeWindow = {
  start: instant("2026-01-01T00:00:00.000Z"),
  end: instant("2027-01-01T00:00:00.000Z"),
};

const testScope: ListingScope = {
  calendar: testCalendar,
  window: testWindow,
  expandRecurrences: false,
};

const crlf = (lines: readonly string[]): string => `${lines.join("\r\n")}\r\n`;

const calendarWith = (bodyLines: readonly string[]): string =>
  crlf(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//keeper.sh//test//EN", ...bodyLines, "END:VCALENDAR"]);

interface VeventFields {
  readonly uid: string;
  readonly lines: readonly string[];
}

const vevent = (fields: VeventFields): readonly string[] => [
  "BEGIN:VEVENT",
  `UID:${fields.uid}`,
  ...fields.lines,
  "END:VEVENT",
];

const simpleEvent = (uid: string, startUtc: string, endUtc: string): readonly string[] =>
  vevent({
    uid,
    lines: [
      `DTSTAMP:${startUtc}`,
      `DTSTART:${startUtc}`,
      `DTEND:${endUtc}`,
      `SUMMARY:${uid}`,
    ],
  });

export {
  calendarWith,
  crlf,
  instant,
  simpleEvent,
  testAccount,
  testCalendar,
  testCalendarId,
  testScope,
  testWindow,
  vevent,
};
export type { VeventFields };
