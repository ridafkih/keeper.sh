import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTimeZoneIdentifier } from "../../../src/ics/utils/resolve-timezone-identifier";
import { wallTimeToInstant } from "../../../src/ics/utils/timezone-instant";
import { WINDOWS_TO_IANA } from "../../../src/ics/utils/windows-timezones";
import {
  CORPUS_DIRECTORY,
  listCorpusFiles,
  readCalendarOutcome,
  readCorpusFile,
} from "../fixtures/declared-timezones/read-corpus-outcomes";
import type { CalendarOutcome, CorpusOutcome } from "../fixtures/declared-timezones/read-corpus-outcomes";

const { mockPullRemoteCalendar } = vi.hoisted(() => ({
  mockPullRemoteCalendar: vi.fn<(...args: unknown[]) => Promise<{ ical: string }>>(),
}));
const { mockPrepareCalendarSnapshot } = vi.hoisted(() => ({
  mockPrepareCalendarSnapshot: vi.fn<(...args: unknown[]) => Promise<{ changed: boolean }>>(),
}));

vi.mock("../../../src/ics/utils/pull-remote-calendar", () => ({
  pullRemoteCalendar: mockPullRemoteCalendar,
}));
vi.mock("../../../src/ics/utils/create-snapshot", () => ({
  prepareCalendarSnapshot: mockPrepareCalendarSnapshot,
}));

const MAX_CORPUS_BYTES = 1024 * 1024;
const SUBPROCESS_TIMEOUT_MS = 60_000;
const SLOW_TEST_TIMEOUT_MS = 120_000;

const span = (start: string, end: string) => ({ end, start });

const EXPECTED_CORPUS: CorpusOutcome = {
  "davx5-vienna.ics": {
    "davx5-after-spring-forward": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:30:00.000Z"),
    "davx5-repeated-hour": span("2026-10-25T00:30:00.000Z", "2026-10-25T01:00:00.000Z"),
  },
  "double-transition-declared.ics": {
    "twice-daily-between-transitions": "unsupported",
  },
  "exchange-customized-mountain.ics": {
    "exchange-after-fall-back": span("2026-11-01T09:30:00.000Z", "2026-11-01T10:00:00.000Z"),
    "exchange-after-spring-forward": span("2026-03-08T09:30:00.000Z", "2026-03-08T10:00:00.000Z"),
    "exchange-before-spring-forward": span("2026-03-08T08:30:00.000Z", "2026-03-08T09:00:00.000Z"),
    "exchange-inside-spring-gap": span("2026-03-08T09:30:00.000Z", "2026-03-08T10:00:00.000Z"),
    "exchange-repeated-hour": span("2026-11-01T07:30:00.000Z", "2026-11-01T08:00:00.000Z"),
    "exchange-summer": span("2026-07-15T18:00:00.000Z", "2026-07-15T19:00:00.000Z"),
    "exchange-weekly-series": "unsupported",
    "exchange-winter": span("2026-01-15T19:00:00.000Z", "2026-01-15T20:00:00.000Z"),
  },
  "google-toronto.ics": {
    "google-after-spring-forward": span("2026-03-08T07:00:00.000Z", "2026-03-08T08:00:00.000Z"),
    "google-before-spring-forward": span("2026-03-08T06:59:00.000Z", "2026-03-08T07:30:00.000Z"),
    "google-repeated-hour": span("2026-11-01T05:30:00.000Z", "2026-11-01T06:00:00.000Z"),
    "google-utc": span("2026-06-01T15:00:00.000Z", "2026-06-01T16:00:00.000Z"),
  },
  "icloud-los-angeles.ics": {
    "icloud-after-fall-back": span("2026-11-01T10:30:00.000Z", "2026-11-01T11:30:00.000Z"),
    "icloud-after-spring-forward": span("2026-03-08T10:30:00.000Z", "2026-03-08T11:30:00.000Z"),
    "icloud-before-spring-forward": span("2026-03-08T09:30:00.000Z", "2026-03-08T10:00:00.000Z"),
    "icloud-repeated-hour": span("2026-11-01T08:30:00.000Z", "2026-11-01T09:00:00.000Z"),
  },
  "kuala-lumpur-unquoted-without-vtimezone.ics": {
    "kuala-lumpur-unquoted-label": "unsupported",
  },
  "kuala-lumpur-with-vtimezone.ics": {
    "kuala-lumpur-declared": span("2026-11-05T02:00:00.000Z", "2026-11-05T03:00:00.000Z"),
  },
  "kuala-lumpur-without-vtimezone.ics": {
    "kuala-lumpur-quoted-label": "unsupported",
  },
  "lotus-west-europe.ics": {
    "lotus-after-fall-back": span("2026-10-25T02:30:00.000Z", "2026-10-25T03:00:00.000Z"),
    "lotus-after-spring-forward": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:00:00.000Z"),
    "lotus-before-spring-forward": span("2026-03-29T00:30:00.000Z", "2026-03-29T01:00:00.000Z"),
    "lotus-inside-spring-gap": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:00:00.000Z"),
    "lotus-repeated-hour": span("2026-10-25T00:30:00.000Z", "2026-10-25T01:00:00.000Z"),
    "lotus-summer": span("2026-07-15T10:00:00.000Z", "2026-07-15T11:00:00.000Z"),
    "lotus-winter": span("2026-01-15T11:00:00.000Z", "2026-01-15T12:00:00.000Z"),
  },
  "manila-declared-rdate.ics": {
    "declared-manila-1936-daylight": span("1936-12-01T03:00:00.000Z", "1936-12-01T04:00:00.000Z"),
    "declared-manila-1945-wartime": span("1945-06-01T03:00:00.000Z", "1945-06-01T04:00:00.000Z"),
    "declared-manila-1946-standard": span("1946-01-15T04:00:00.000Z", "1946-01-15T05:00:00.000Z"),
    "declared-manila-1977-daylight": span("1977-06-01T03:00:00.000Z", "1977-06-01T04:00:00.000Z"),
    "declared-manila-1977-standard": span("1977-12-01T04:00:00.000Z", "1977-12-01T05:00:00.000Z"),
    "declared-manila-today": span("2026-11-05T02:00:00.000Z", "2026-11-05T03:00:00.000Z"),
  },
  "mozilla-europe-london.ics": {
    "london-after-fall-back": span("2026-10-25T02:30:00.000Z", "2026-10-25T03:30:00.000Z"),
    "london-after-spring-forward": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:00:00.000Z"),
    "london-before-spring-forward": span("2026-03-29T00:30:00.000Z", "2026-03-29T01:00:00.000Z"),
    "london-inside-spring-gap": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:00:00.000Z"),
    "london-repeated-hour": span("2026-10-25T00:30:00.000Z", "2026-10-25T01:00:00.000Z"),
  },
  "outlook-chennai-kathmandu.ics": {
    "chennai-one-off": span("2026-07-15T06:30:00.000Z", "2026-07-15T07:30:00.000Z"),
    "kathmandu-one-off": span("2026-07-15T06:15:00.000Z", "2026-07-15T07:15:00.000Z"),
  },
  "proton-zurich.ics": {
    "proton-inside-spring-gap": span("2026-03-29T01:30:00.000Z", "2026-03-29T02:00:00.000Z"),
    "proton-summer": span("2026-07-01T07:00:00.000Z", "2026-07-01T08:00:00.000Z"),
    "proton-winter": span("2026-12-01T08:00:00.000Z", "2026-12-01T09:00:00.000Z"),
  },
  "stale-sender-edmonton.ics": {
    "stale-edmonton-after-abolished-fall-back": span("2026-11-01T07:30:00.000Z", "2026-11-01T08:30:00.000Z"),
    "stale-edmonton-winter": span("2027-01-15T18:00:00.000Z", "2027-01-15T19:00:00.000Z"),
  },
  "thunderbird-berlin.ics": {
    "thunderbird-after-fall-back": span("2027-10-31T02:30:00.000Z", "2027-10-31T03:30:00.000Z"),
    "thunderbird-before-spring-forward": span("2027-03-28T00:30:00.000Z", "2027-03-28T01:00:00.000Z"),
    "thunderbird-repeated-hour": span("2027-10-31T00:59:30.000Z", "2027-10-31T01:29:30.000Z"),
  },
  "tzurl-manila.ics": {
    "tzurl-manila-today": span("2026-11-05T02:00:00.000Z", "2026-11-05T03:00:00.000Z"),
  },
};

const UNRESOLVABLE_DECLARED_IDS = [
  "Customized Time Zone",
  "Philippine Time (tzurl copy)",
  "Test Twice Daily Zone",
  "W. Europe",
  "(UTC+08:00) Kuala Lumpur, Singapore",
];

const UID_PATTERN = /^UID:(.+)$/gm;

const readFixtureUids = (name: string): string[] =>
  [...readCorpusFile(name).matchAll(UID_PATTERN)].map(([, uid]) => uid?.trim() ?? "").toSorted();

const readCorpusOutcomesInTimeZone = (timeZone: string): CorpusOutcome => {
  const result = spawnSync(
    process.execPath,
    [join(CORPUS_DIRECTORY, "read-corpus-outcomes.ts")],
    {
      encoding: "utf8",
      env: { ...process.env, TZ: timeZone },
      timeout: SUBPROCESS_TIMEOUT_MS,
    },
  );
  if (result.status !== 0) {
    throw new Error(`corpus probe under TZ=${timeZone} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as CorpusOutcome;
};

const sumCorpusBytes = (): number =>
  readdirSync(CORPUS_DIRECTORY).reduce(
    (total, name) => total + statSync(join(CORPUS_DIRECTORY, name)).size,
    0,
  );

const buildFeed = (lines: string[]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//Test//EN",
  ...lines,
  "END:VCALENDAR",
].join("\r\n");

const buildConfig = () => ({
  calendarId: "calendar-1",
  database: {} as never,
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: {
      timeMax: new Date("2027-01-01T00:00:00.000Z"),
      timeMin: new Date("2026-01-01T00:00:00.000Z"),
    },
  },
  url: "https://example.com/calendar.ics",
});

const fetchFeed = async (ical: string) => {
  const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });
  return createIcsSourceFetcher(buildConfig()).fetchEvents();
};

const PREFIXED_AND_LINKED_IDS: Record<string, string> = {
  "/citadel.org/20190914_1/Europe/Paris": "Europe/Paris",
  "/freeassociation.sourceforge.net/Tzfile/Europe/Kiev": "Europe/Kiev",
  "/mozilla.org/20050126_1/America/Denver": "America/Denver",
  "Asia/Calcutta": "Asia/Calcutta",
  "US/Eastern": "US/Eastern",
};

const COVERAGE_WALL_TIMES = ["2026-01-15T12:00:00.000Z", "2026-07-15T12:00:00.000Z"];

const toIcsWallTime = (iso: string): string =>
  iso.replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "");

const buildUndeclaredZoneCalendar = (timeZoneIds: string[]): string => buildFeed(
  timeZoneIds.flatMap((timeZoneId, zoneIndex) => COVERAGE_WALL_TIMES.flatMap((wallTime, timeIndex) => [
    "BEGIN:VEVENT",
    `UID:coverage-${zoneIndex}-${timeIndex}`,
    "DTSTAMP:20260101T000000Z",
    `DTSTART;TZID="${timeZoneId}":${toIcsWallTime(wallTime)}`,
    "DURATION:PT1H",
    "SUMMARY:Busy",
    "END:VEVENT",
  ])),
);

const expectedCoverage = (zones: Record<string, string>): CalendarOutcome =>
  Object.fromEntries(Object.values(zones).flatMap((timeZone, zoneIndex) =>
    COVERAGE_WALL_TIMES.map((wallTime, timeIndex) => {
      const start = wallTimeToInstant(new Date(wallTime), timeZone);
      return [
        `coverage-${zoneIndex}-${timeIndex}`,
        span(start.toISOString(), new Date(start.getTime() + 3_600_000).toISOString()),
      ];
    })));

describe("declared VTIMEZONE corpus", () => {
  beforeEach(() => {
    mockPullRemoteCalendar.mockReset();
    mockPrepareCalendarSnapshot.mockReset();
  });

  it("keeps the fixture directory under 1 MB", () => {
    expect(sumCorpusBytes()).toBeLessThan(MAX_CORPUS_BYTES);
  });

  it("states an expectation for every event in every fixture", () => {
    const fixtureUids = Object.fromEntries(listCorpusFiles().map((name) => [name, readFixtureUids(name)]));
    const expectedUids = Object.fromEntries(Object.entries(EXPECTED_CORPUS).map(([name, events]) =>
      [name, Object.keys(events).toSorted()]));

    expect(fixtureUids).toEqual(expectedUids);
  });

  it("uses identifiers no resolver maps for the declared-engine fixtures", () => {
    expect(UNRESOLVABLE_DECLARED_IDS.map((id) => resolveTimeZoneIdentifier(id)))
      .toEqual(UNRESOLVABLE_DECLARED_IDS.map(() => globalThis.undefined));
  });

  it.each(listCorpusFiles())("reads %s at the literal UTC instants on both sides of each transition", (name) => {
    expect(readCalendarOutcome([readCorpusFile(name)])).toEqual(EXPECTED_CORPUS[name]);
  });

  it("reads the whole corpus identically in a server running America/Edmonton", () => {
    expect(readCorpusOutcomesInTimeZone("America/Edmonton")).toEqual(EXPECTED_CORPUS);
  }, SLOW_TEST_TIMEOUT_MS);

  it("reads the whole corpus identically in a server running UTC", () => {
    expect(readCorpusOutcomesInTimeZone("UTC")).toEqual(EXPECTED_CORPUS);
  }, SLOW_TEST_TIMEOUT_MS);

  it("withholds an unresolved zone from the second resource of a CalDAV read instead of losing it in the merge", () => {
    const outcome = readCalendarOutcome([
      readCorpusFile("google-toronto.ics"),
      readCorpusFile("kuala-lumpur-without-vtimezone.ics"),
    ]);

    expect(outcome).toEqual({
      ...EXPECTED_CORPUS["google-toronto.ics"],
      ...EXPECTED_CORPUS["kuala-lumpur-without-vtimezone.ics"],
    });
  });

  it("withholds a label with no VTIMEZONE from an ICS feed but keeps it in the feed so its stored state is not deleted", async () => {
    const result = await fetchFeed(readCorpusFile("kuala-lumpur-without-vtimezone.ics"));

    expect(result.unsupportedEventUids).toEqual(["kuala-lumpur-quoted-label"]);
    expect(result.events.map(({ uid }) => uid)).toContain("kuala-lumpur-quoted-label");
  });

  it("reads declared custom zones in an ICS feed at their declared instants", async () => {
    const result = await fetchFeed(readCorpusFile("exchange-customized-mountain.ics"));
    const expected = EXPECTED_CORPUS["exchange-customized-mountain.ics"] as CalendarOutcome;
    const oneOffUids = Object.keys(expected).filter((uid) => expected[uid] !== "unsupported");

    expect(Object.fromEntries(result.events
      .filter(({ uid }) => oneOffUids.includes(uid))
      .map(({ endTime, startTime, uid }) => [uid, span(startTime.toISOString(), endTime.toISOString())])))
      .toEqual(Object.fromEntries(oneOffUids.map((uid) => [uid, expected[uid]])));
    expect(result.unsupportedEventUids).toEqual(["exchange-weekly-series"]);
  });
});

describe("identifiers that once relied on a synthesized VTIMEZONE", () => {
  it("resolves every Windows name with no VTIMEZONE to its CLDR zone", () => {
    expect(readCalendarOutcome([buildUndeclaredZoneCalendar(Object.keys(WINDOWS_TO_IANA))]))
      .toEqual(expectedCoverage(WINDOWS_TO_IANA));
  }, SLOW_TEST_TIMEOUT_MS);

  it("resolves prefixed and linked identifiers with no VTIMEZONE to their IANA zone", () => {
    expect(readCalendarOutcome([buildUndeclaredZoneCalendar(Object.keys(PREFIXED_AND_LINKED_IDS))]))
      .toEqual(expectedCoverage(PREFIXED_AND_LINKED_IDS));
  }, SLOW_TEST_TIMEOUT_MS);
});
