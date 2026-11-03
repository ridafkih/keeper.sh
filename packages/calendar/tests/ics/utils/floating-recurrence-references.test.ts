import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCalendarTimeZoneToFloatingEventDates,
  createIcsSourceFetcher,
} from "../../../src/ics/utils/fetch-adapter";
import {
  CalDAVUnreadableResourceError,
  parseICalCalendarsToRemoteEvents,
} from "../../../src/providers/caldav/shared/ics";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import {
  parseStoredRecurrenceForMaterialization,
  serializeStoredIcsRecurrenceRule,
} from "../../../src/core/events/stored-recurrence";
import type { SourceEvent, SyncableEvent } from "../../../src/core/types";

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

const WINDOW = {
  end: new Date("2027-01-01T00:00:00.000Z"),
  start: new Date("2026-01-01T00:00:00.000Z"),
};

const SERIES_UID = "series@test";

const buildFetcherConfig = () => ({
  calendarId: "calendar-1",
  database: {} as never,
  plan: {
    futureRange: "2_years" as const,
    historicRange: "1_week" as const,
    window: { timeMax: WINDOW.end, timeMin: WINDOW.start },
  },
  url: "https://example.com/calendar.ics",
});

const buildCalendar = (calendarLines: string[], ...eventBlocks: string[][]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  ...calendarLines,
  ...eventBlocks.flatMap((eventLines) => [
    "BEGIN:VEVENT",
    `UID:${SERIES_UID}`,
    "DTSTAMP:20260101T000000Z",
    ...eventLines,
    "END:VEVENT",
  ]),
  "END:VCALENDAR",
].join("\r\n");

const zonedMaster = (timeZone: string, start: string, end: string, rule: string): string[] => [
  `DTSTART;TZID=${timeZone}:${start}`,
  `DTEND;TZID=${timeZone}:${end}`,
  `RRULE:${rule}`,
];

const toSyncableEvent = (event: SourceEvent, index: number): SyncableEvent => {
  const eventId = `${event.uid}#${index}`;
  let storedExceptionDates: string | null = null;
  if (event.exceptionDates) {
    storedExceptionDates = JSON.stringify(event.exceptionDates);
  }
  let storedRecurrenceRule: string | null = null;
  if (event.recurrenceRule) {
    storedRecurrenceRule = serializeStoredIcsRecurrenceRule(
      event.recurrenceRule,
      event.recurrenceDuration,
    );
  }
  const recurrence = parseStoredRecurrenceForMaterialization({
    eventId,
    exceptionDates: storedExceptionDates,
    recurrenceId: event.recurrenceId ?? null,
    recurrenceRule: storedRecurrenceRule,
  });
  return {
    calendarId: "calendar-1",
    calendarName: "Primary",
    calendarUrl: null,
    endTime: event.endTime,
    ...recurrence,
    id: eventId,
    isAllDay: event.isAllDay,
    sourceEventUid: event.uid,
    startTime: event.startTime,
    summary: event.title ?? "",
    ...(event.startTimeZone && { startTimeZone: event.startTimeZone }),
  };
};

interface DestinationView {
  ids: string[];
  starts: string[];
  unsupportedEventUids: string[];
}

const materializeForDestinations = (
  events: SourceEvent[],
  unsupportedEventUids: string[],
): DestinationView => {
  const withheld = new Set(unsupportedEventUids);
  const occurrences = materializeRecurrenceEvents(
    events.filter(({ uid }) => !withheld.has(uid)).map((event, index) => toSyncableEvent(event, index)),
    WINDOW,
  );
  return {
    ids: occurrences.map(({ id }) => id),
    starts: occurrences.map(({ startTime }) => startTime.toISOString()),
    unsupportedEventUids,
  };
};

const syncIcsFeed = async (ical: string): Promise<DestinationView> => {
  mockPullRemoteCalendar.mockResolvedValueOnce({ ical });
  mockPrepareCalendarSnapshot.mockResolvedValueOnce({ changed: false });
  const result = await createIcsSourceFetcher(buildFetcherConfig()).fetchEvents();
  return materializeForDestinations(result.events, result.unsupportedEventUids ?? []);
};

const syncCalDavResource = (ical: string): DestinationView => {
  try {
    const resources = parseICalCalendarsToRemoteEvents([ical]);
    return materializeForDestinations(
      resources.events,
      resources.unsupportedEvents.map(({ uid }) => uid),
    );
  } catch (error) {
    if (!(error instanceof CalDAVUnreadableResourceError)) {
      throw error;
    }
    return materializeForDestinations([], [SERIES_UID]);
  }
};

const HOUR_MS = 60 * 60 * 1000;

const toIcsUtc = (isoInstant: string, offsetMilliseconds = 0): string =>
  new Date(new Date(isoInstant).getTime() + offsetMilliseconds)
    .toISOString()
    .replaceAll(/[-:]|\.000/g, "");

const shiftedBy = (isoInstant: string, offsetMilliseconds: number): string =>
  new Date(new Date(isoInstant).getTime() + offsetMilliseconds).toISOString();

const expectNoDuplicates = (view: DestinationView): void => {
  expect(new Set(view.starts).size).toBe(view.starts.length);
  expect(new Set(view.ids).size).toBe(view.ids.length);
};

const LOS_ANGELES_EVENING = zonedMaster(
  "America/Los_Angeles",
  "20260105T170000",
  "20260105T180000",
  "FREQ=DAILY;COUNT=5",
);
const LOS_ANGELES_EVENING_STARTS = [
  "2026-01-06T01:00:00.000Z",
  "2026-01-07T01:00:00.000Z",
  "2026-01-08T01:00:00.000Z",
  "2026-01-09T01:00:00.000Z",
  "2026-01-10T01:00:00.000Z",
];
const TOKYO_MORNING = zonedMaster(
  "Asia/Tokyo",
  "20260105T100000",
  "20260105T110000",
  "FREQ=DAILY;COUNT=5",
);
const TOKYO_MORNING_STARTS = [
  "2026-01-05T01:00:00.000Z",
  "2026-01-06T01:00:00.000Z",
  "2026-01-07T01:00:00.000Z",
  "2026-01-08T01:00:00.000Z",
  "2026-01-09T01:00:00.000Z",
];
const TOKYO_EVENING = zonedMaster(
  "Asia/Tokyo",
  "20260105T170000",
  "20260105T180000",
  "FREQ=DAILY;COUNT=5",
);
const TOKYO_EVENING_STARTS = [
  "2026-01-05T08:00:00.000Z",
  "2026-01-06T08:00:00.000Z",
  "2026-01-07T08:00:00.000Z",
  "2026-01-08T08:00:00.000Z",
  "2026-01-09T08:00:00.000Z",
];

const without = (starts: string[], removed: string): string[] =>
  starts.filter((start) => start !== removed);

const replacing = (starts: string[], removed: string, added: string): string[] =>
  [...without(starts, removed), added].toSorted();

const SERIES_WITH_DATE_REFERENCES = [
  {
    excludedDay: "2026-01-07T01:00:00.000Z",
    master: LOS_ANGELES_EVENING,
    movedWallTime: "20260106T200000",
    name: "Los Angeles at 17:00",
    starts: LOS_ANGELES_EVENING_STARTS,
    timeZone: "America/Los_Angeles",
  },
  {
    excludedDay: "2026-01-06T01:00:00.000Z",
    master: TOKYO_MORNING,
    movedWallTime: "20260106T130000",
    name: "Tokyo at 10:00",
    starts: TOKYO_MORNING_STARTS,
    timeZone: "Asia/Tokyo",
  },
  {
    excludedDay: "2026-01-06T08:00:00.000Z",
    master: TOKYO_EVENING,
    movedWallTime: "20260106T200000",
    name: "Tokyo at 17:00",
    starts: TOKYO_EVENING_STARTS,
    timeZone: "Asia/Tokyo",
  },
];

const withRule = (master: string[], rule: string): string[] => master.map((line) => {
  if (line.startsWith("RRULE:")) {
    return `RRULE:${rule}`;
  }
  return line;
});

const wallTimeOf = (master: string[]): string => {
  const start = master.find((line) => line.startsWith("DTSTART")) ?? "";
  return start.slice(start.indexOf("T", start.indexOf(":")) + 1);
};

beforeEach(() => {
  mockPullRemoteCalendar.mockReset();
  mockPrepareCalendarSnapshot.mockReset();
});

describe.each(SERIES_WITH_DATE_REFERENCES)("a timed series in $name", (series) => {
  it("drops the occurrence on the local day a VALUE=DATE EXDATE names", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...series.master,
      "EXDATE;VALUE=DATE:20260106",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(without(series.starts, series.excludedDay));
  });

  it("drops the occurrence on the local day a bare date EXDATE names", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...series.master,
      "EXDATE:20260106",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(without(series.starts, series.excludedDay));
  });

  it("keeps every occurrence on the local day a DATE UNTIL names", async () => {
    const view = await syncIcsFeed(buildCalendar([], withRule(
      series.master,
      "FREQ=DAILY;UNTIL=20260109",
    )));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(series.starts);
  });

  it("replaces the slot a VALUE=DATE RECURRENCE-ID names instead of duplicating it", async () => {
    const view = await syncIcsFeed(buildCalendar([], series.master, [
      "RECURRENCE-ID;VALUE=DATE:20260106",
      `DTSTART;TZID=${series.timeZone}:${series.movedWallTime}`,
      `DURATION:PT1H`,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(
      replacing(series.starts, series.excludedDay, shiftedBy(series.excludedDay, 3 * HOUR_MS)),
    );
    expectNoDuplicates(view);
  });

  it("drops the local day's occurrence through the CalDAV reader too", () => {
    const view = syncCalDavResource(buildCalendar([], [
      ...series.master,
      "EXDATE;VALUE=DATE:20260106",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(without(series.starts, series.excludedDay));
  });

  it("keeps the DATE UNTIL day through the CalDAV reader too", () => {
    const view = syncCalDavResource(buildCalendar([], withRule(
      series.master,
      "FREQ=DAILY;UNTIL=20260109",
    )));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(series.starts);
  });

  it("replaces the VALUE=DATE RECURRENCE-ID slot through the CalDAV reader too", () => {
    const view = syncCalDavResource(buildCalendar([], series.master, [
      "RECURRENCE-ID;VALUE=DATE:20260106",
      `DTSTART;TZID=${series.timeZone}:${series.movedWallTime}`,
      `DURATION:PT1H`,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(
      replacing(series.starts, series.excludedDay, shiftedBy(series.excludedDay, 3 * HOUR_MS)),
    );
  });
});

const OVERRIDE_ZONE_PAIRS = [
  {
    master: LOS_ANGELES_EVENING,
    name: "a Los Angeles series moved by an override written in Tokyo time",
    originalSlot: "2026-01-07T01:00:00.000Z",
    overrideStart: "DTSTART;TZID=Asia/Tokyo:20260107T120000",
    overrideZone: "Asia/Tokyo",
    overrideEnd: "DTEND;TZID=Asia/Tokyo:20260107T130000",
    movedStart: "2026-01-07T03:00:00.000Z",
    starts: LOS_ANGELES_EVENING_STARTS,
  },
  {
    master: TOKYO_EVENING,
    name: "a Tokyo series moved by an override written in Los Angeles time",
    originalSlot: "2026-01-06T08:00:00.000Z",
    overrideStart: "DTSTART;TZID=America/Los_Angeles:20260106T020000",
    overrideZone: "America/Los_Angeles",
    overrideEnd: "DTEND;TZID=America/Los_Angeles:20260106T030000",
    movedStart: "2026-01-06T10:00:00.000Z",
    starts: TOKYO_EVENING_STARTS,
  },
  {
    master: TOKYO_MORNING,
    name: "a Tokyo series moved by an override written in Los Angeles time at 10:00",
    originalSlot: "2026-01-06T01:00:00.000Z",
    overrideStart: "DTSTART;TZID=America/Los_Angeles:20260105T190000",
    overrideZone: "America/Los_Angeles",
    overrideEnd: "DTEND;TZID=America/Los_Angeles:20260105T200000",
    movedStart: "2026-01-06T03:00:00.000Z",
    starts: TOKYO_MORNING_STARTS,
  },
];

describe.each(OVERRIDE_ZONE_PAIRS)("$name", (pair) => {
  it("anchors a floating RECURRENCE-ID to the series zone, replacing the slot", async () => {
    const view = await syncIcsFeed(buildCalendar([], pair.master, [
      `RECURRENCE-ID:20260106T${wallTimeOf(pair.master)}`,
      pair.overrideStart,
      pair.overrideEnd,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(replacing(pair.starts, pair.originalSlot, pair.movedStart));
    expectNoDuplicates(view);
  });

  it("anchors it the same way when the override is written in UTC under another calendar zone", async () => {
    const view = await syncIcsFeed(buildCalendar([`X-WR-TIMEZONE:${pair.overrideZone}`], pair.master, [
      `RECURRENCE-ID:20260106T${wallTimeOf(pair.master)}`,
      `DTSTART:${toIcsUtc(pair.movedStart)}`,
      `DTEND:${toIcsUtc(pair.movedStart, HOUR_MS)}`,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(replacing(pair.starts, pair.originalSlot, pair.movedStart));
    expectNoDuplicates(view);
  });

  it("syncs a UTC override with no calendar zone instead of withholding the series", async () => {
    const view = await syncIcsFeed(buildCalendar([], pair.master, [
      `RECURRENCE-ID:20260106T${wallTimeOf(pair.master)}`,
      `DTSTART:${toIcsUtc(pair.movedStart)}`,
      `DTEND:${toIcsUtc(pair.movedStart, HOUR_MS)}`,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(replacing(pair.starts, pair.originalSlot, pair.movedStart));
  });

  it("anchors the floating RECURRENCE-ID through the CalDAV reader too", () => {
    const view = syncCalDavResource(buildCalendar([], pair.master, [
      `RECURRENCE-ID:20260106T${wallTimeOf(pair.master)}`,
      pair.overrideStart,
      pair.overrideEnd,
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(replacing(pair.starts, pair.originalSlot, pair.movedStart));
  });
});

describe("a Los Angeles series with selectors and a DATE EXDATE", () => {
  it("drops every BYHOUR slot on the excluded local day", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster(
        "America/Los_Angeles",
        "20260105T090000",
        "20260105T093000",
        "FREQ=DAILY;BYHOUR=9,14;COUNT=6",
      ),
      "EXDATE;VALUE=DATE:20260106",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual([
      "2026-01-05T17:00:00.000Z",
      "2026-01-05T22:00:00.000Z",
      "2026-01-07T17:00:00.000Z",
      "2026-01-07T22:00:00.000Z",
    ]);
  });

  it("drops every hour of an excluded fall-back day, both copies of the repeated hour included", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster(
        "America/Los_Angeles",
        "20261031T200000",
        "20261031T203000",
        "FREQ=HOURLY;COUNT=40",
      ),
      "EXDATE;VALUE=DATE:20261101",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual([
      "2026-11-01T03:00:00.000Z",
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T06:00:00.000Z",
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
      "2026-11-02T10:00:00.000Z",
      "2026-11-02T11:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
      "2026-11-02T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-02T15:00:00.000Z",
      "2026-11-02T16:00:00.000Z",
      "2026-11-02T17:00:00.000Z",
      "2026-11-02T18:00:00.000Z",
    ]);
  });

  it("still syncs a MINUTELY series with a DATE EXDATE, dropping the series' own time of day", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster(
        "America/Los_Angeles",
        "20260105T170000",
        "20260105T171500",
        "FREQ=MINUTELY;INTERVAL=720;COUNT=6",
      ),
      "EXDATE;VALUE=DATE:20260106",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual([
      "2026-01-06T01:00:00.000Z",
      "2026-01-06T13:00:00.000Z",
      "2026-01-07T13:00:00.000Z",
      "2026-01-08T01:00:00.000Z",
      "2026-01-08T13:00:00.000Z",
    ]);
  });
});

const repeated = (values: number[], times: number): string =>
  Array.from({ length: times }, () => values).flat().join(",");

describe("a DATE EXDATE on a series with long selector lists", () => {
  it("writes each distinct BYHOUR slot of the excluded day once however often the lists repeat them", () => {
    const startedAt = performance.now();
    const normalized = applyCalendarTimeZoneToFloatingEventDates(buildCalendar([], [
      ...zonedMaster(
        "America/Los_Angeles",
        "20260105T090000",
        "20260105T093000",
        `FREQ=DAILY;BYHOUR=${repeated([14, 9, 99], 1000)};BYMINUTE=${repeated([0, 75], 1000)};COUNT=6`,
      ),
      "EXDATE;VALUE=DATE:20260106",
    ]), globalThis.undefined);

    expect(normalized.split("\r\n").filter((line) => line.startsWith("EXDATE"))).toEqual([
      "EXDATE;TZID=America/Los_Angeles:20260106T090000,20260106T140000",
    ]);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });

  it("withholds a series whose excluded day would cover more slots than a day of minutes, quickly", async () => {
    const hours = Array.from({ length: 24 }, (_unused, hour) => hour).join(",");
    const minutes = Array.from({ length: 60 }, (_unused, minute) => minute).join(",");
    const startedAt = performance.now();
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster(
        "America/Los_Angeles",
        "20261205T000000",
        "20261205T000001",
        `FREQ=DAILY;BYHOUR=${hours};BYMINUTE=${minutes};BYSECOND=0,30;COUNT=6`,
      ),
      `EXDATE;VALUE=DATE:${Array.from({ length: 300 }, (_unused, day) => `2026${String(Math.floor(day / 28) + 1).padStart(2, "0")}${String((day % 28) + 1).padStart(2, "0")}`).join(",")}`,
    ]));

    expect(view.unsupportedEventUids).toEqual([SERIES_UID]);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });
});

const HOURS_OF_DAY = Array.from({ length: 24 }, (_unused, hour) => hour).join(",");
const MINUTES_OF_HOUR = Array.from({ length: 60 }, (_unused, minute) => minute).join(",");
const MINUTE_SLOTS_RULE = `FREQ=DAILY;BYHOUR=${HOURS_OF_DAY};BYMINUTE=${MINUTES_OF_HOUR}`;

const listDates = (count: number, offset = 0): string[] => Array.from({ length: count }, (_unused, index) =>
  new Date(Date.UTC(2026, 0, 1 + offset + index)).toISOString().slice(0, 10).replaceAll("-", ""));

const buildMinuteSlotSeries = (uid: string, exclusionLines: string[]): string[] => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20260101T000000Z",
  ...zonedMaster("America/Los_Angeles", "20261205T000000", "20261205T000001", `${MINUTE_SLOTS_RULE};COUNT=2`),
  ...exclusionLines,
  "END:VEVENT",
];

const buildMultiEventCalendar = (...events: string[][]): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//test//test//EN",
  ...events.flat(),
  "END:VCALENDAR",
].join("\r\n");

describe("the DATE EXDATE slots one calendar may expand to", () => {
  it("still excludes every slot of a day that yields exactly a day of minutes", () => {
    const normalized = applyCalendarTimeZoneToFloatingEventDates(buildCalendar([], [
      ...zonedMaster("America/Los_Angeles", "20260105T000000", "20260105T000001", `${MINUTE_SLOTS_RULE};COUNT=1441`),
      "EXDATE;VALUE=DATE:20260105",
    ]), globalThis.undefined);
    const exclusion = normalized.split("\r\n").find((line) => line.startsWith("EXDATE")) ?? "";
    const [property, values = ""] = exclusion.split(":");
    const slots = values.split(",");

    expect(property).toBe("EXDATE;TZID=America/Los_Angeles");
    expect(new Set(slots).size).toBe(1440);
    expect(slots[0]).toBe("20260105T000000");
    expect(slots.at(-1)).toBe("20260105T235900");
  });

  it("withholds a series whose one EXDATE line of whole days passes the calendar's slot budget, quickly", async () => {
    const startedAt = performance.now();
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster("America/Los_Angeles", "20261205T000000", "20261205T000001", `${MINUTE_SLOTS_RULE};COUNT=2`),
      `EXDATE;VALUE=DATE:${listDates(70).join(",")}`,
    ]));

    expect(view.unsupportedEventUids).toEqual([SERIES_UID]);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });

  it("withholds a series whose many EXDATE lines together pass the calendar's slot budget, quickly", async () => {
    const startedAt = performance.now();
    const view = await syncIcsFeed(buildCalendar([], [
      ...zonedMaster("America/Edmonton", "20261205T000000", "20261205T000100", `FREQ=HOURLY;BYMINUTE=${MINUTES_OF_HOUR};COUNT=5`),
      ...Array.from({ length: 20 }, (_unused, line) => `EXDATE;VALUE=DATE:${listDates(60, line * 60).join(",")}`),
    ]));

    expect(view.unsupportedEventUids).toEqual([SERIES_UID]);
    expect(performance.now() - startedAt).toBeLessThan(2000);
  });

  it("spends one budget across the calendar's events and keeps syncing series that exclude a single slot a day", async () => {
    const view = await syncIcsFeed(buildMultiEventCalendar(
      buildMinuteSlotSeries("first@test", [`EXDATE;VALUE=DATE:${listDates(2).join(",")}`]),
      buildMinuteSlotSeries("second@test", [`EXDATE;VALUE=DATE:${listDates(2).join(",")}`]),
      [
        "BEGIN:VEVENT",
        "UID:daily@test",
        "DTSTAMP:20260101T000000Z",
        ...zonedMaster("America/Los_Angeles", "20260105T090000", "20260105T093000", "FREQ=DAILY;COUNT=3"),
        "EXDATE;VALUE=DATE:20260106",
        "END:VEVENT",
      ],
    ));

    expect(view.unsupportedEventUids).toEqual(["second@test"]);
    expect(view.starts.toSorted()).toEqual([
      "2026-01-05T17:00:00.000Z",
      "2026-01-07T17:00:00.000Z",
      "2026-12-05T08:00:00.000Z",
      "2026-12-05T08:01:00.000Z",
    ]);
  });
});

describe("an override with no series master", () => {
  it("keeps resolving its floating RECURRENCE-ID in its own DTSTART zone (regression pin, passes on main)", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      "RECURRENCE-ID:20260106T170000",
      "DTSTART;TZID=America/Los_Angeles:20260106T200000",
      "DTEND;TZID=America/Los_Angeles:20260106T210000",
    ]));

    expect(view.unsupportedEventUids).toEqual([]);
    expect(view.starts).toEqual(["2026-01-07T04:00:00.000Z"]);
  });
});

describe.each([
  { master: LOS_ANGELES_EVENING, name: "Los Angeles", starts: LOS_ANGELES_EVENING_STARTS, timeZone: "America/Los_Angeles" },
  { master: TOKYO_EVENING, name: "Tokyo", starts: TOKYO_EVENING_STARTS, timeZone: "Asia/Tokyo" },
])("same-zone floating references on a $name series (regression pins, pass on main)", (series) => {
  const thirdSlot = series.starts[2] ?? "";

  it("removes the occurrence a floating EXDATE names", async () => {
    const view = await syncIcsFeed(buildCalendar([], [
      ...series.master,
      `EXDATE:20260107T170000`,
    ]));

    expect(view.starts).toEqual(without(series.starts, thirdSlot));
  });

  it("replaces the slot a floating RECURRENCE-ID names", async () => {
    const view = await syncIcsFeed(buildCalendar([], series.master, [
      `RECURRENCE-ID:20260107T170000`,
      `DTSTART;TZID=${series.timeZone}:20260107T190000`,
      `DTEND;TZID=${series.timeZone}:20260107T200000`,
    ]));

    expect(view.starts).toEqual(replacing(series.starts, thirdSlot, shiftedBy(thirdSlot, 2 * HOUR_MS)));
    expectNoDuplicates(view);
  });

  it("keeps the last occurrence a floating UNTIL names", async () => {
    const view = await syncIcsFeed(buildCalendar([], withRule(
      series.master,
      "FREQ=DAILY;UNTIL=20260109T170000",
    )));

    expect(view.starts).toEqual(series.starts);
  });
});
