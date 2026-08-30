import { describe, expect, it } from "vitest";
import { KEEPER_EVENT_SUFFIX } from "@keeper.sh/constants";
import {
  filterNativeDuplicateOccurrences,
  getNativeOccurrenceIndex,
} from "../../../src/core/events/native-duplicates";
import { materializeRecurrenceEvents } from "../../../src/core/events/recurrence-materializer";
import type { BunSQLClient } from "../../../src/core/database-client";
import type { MaterializedSyncableEvent, SyncableEvent } from "../../../src/core/types";
import type { SyncWindow } from "../../../src/core/sync/sync-range";

const DESTINATION_CALENDAR_ID = "destination-calendar";
const SOURCE_CALENDAR_ID = "source-calendar";
const SHARED_UID = "invitation-uid@organizer.example";

const WINDOW: SyncWindow = {
  timeMax: new Date("2026-02-01T00:00:00.000Z"),
  timeMin: new Date("2026-01-01T00:00:00.000Z"),
};

/*
 * Spans the 8 March 2026 spring-forward transition, on either side of which the same
 * wall time names a different instant.
 */
const DAYLIGHT_WINDOW: SyncWindow = {
  timeMax: new Date("2026-04-01T00:00:00.000Z"),
  timeMin: new Date("2026-02-01T00:00:00.000Z"),
};

const DAYLIGHT_ZONE = "America/New_York";

const WEEKLY_RULE = { count: 4, frequency: "WEEKLY" } as const;
const STORED_WEEKLY_RULE = JSON.stringify(WEEKLY_RULE);
const DAILY_RULE = { count: 5, frequency: "DAILY" } as const;
const STORED_DAILY_RULE = JSON.stringify(DAILY_RULE);
const STORED_ENDLESS_WEEKLY_RULE = JSON.stringify({ frequency: "WEEKLY" });
const STORED_ENDLESS_DAILY_RULE = JSON.stringify({ frequency: "DAILY" });
const STORED_SECONDLY_RULE = JSON.stringify({ frequency: "SECONDLY" });

interface NativeEventStateRow {
  endTime: Date;
  exceptionDates: string | null;
  id: string;
  isAllDay: boolean | null;
  recurrenceId: Date | null;
  recurrenceRule: string | null;
  sourceEventUid: string | null;
  startTime: Date;
  startTimeZone: string | null;
}

const createNativeRow = (
  overrides: Partial<NativeEventStateRow> = {},
): NativeEventStateRow => ({
  endTime: new Date("2026-01-05T10:00:00.000Z"),
  exceptionDates: null,
  id: "native-state-1",
  isAllDay: false,
  recurrenceId: null,
  recurrenceRule: null,
  sourceEventUid: SHARED_UID,
  startTime: new Date("2026-01-05T09:00:00.000Z"),
  startTimeZone: null,
  ...overrides,
});

type NativeQueryResult = Promise<NativeEventStateRow[]> & {
  orderBy: () => NativeQueryResult;
};

/*
 * The stub answers event_states alone and offers no innerJoin: joining calendars is what
 * pulls in the destination's own outbound-sync exclusions, which a native copy must never
 * be filtered by. A join attempt fails here instead of silently narrowing the index.
 */
const createNativeDatabase = (
  rows: NativeEventStateRow[],
  wheres: unknown[] = [],
): BunSQLClient => {
  const results: NativeQueryResult = Object.assign(Promise.resolve(rows), {
    orderBy: (): NativeQueryResult => results,
  });
  const chain = {
    from: () => chain,
    where: (condition: unknown) => {
      wheres.push(condition);
      return results;
    },
  };

  return { select: () => chain } as unknown as BunSQLClient;
};

const buildIndex = (
  rows: NativeEventStateRow[],
  window: SyncWindow = WINDOW,
) => getNativeOccurrenceIndex(
  createNativeDatabase(rows),
  DESTINATION_CALENDAR_ID,
  window,
);

const createSourceOccurrence = (
  overrides: Partial<MaterializedSyncableEvent> = {},
): MaterializedSyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-01-05T10:00:00.000Z"),
  eventStateId: "source-state-1",
  id: "source-state-1",
  sourceEventUid: SHARED_UID,
  startTime: new Date("2026-01-05T09:00:00.000Z"),
  summary: "Design review",
  ...overrides,
} as MaterializedSyncableEvent);

const createSourceMaster = (overrides: Partial<SyncableEvent> = {}): SyncableEvent => ({
  calendarId: SOURCE_CALENDAR_ID,
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-01-05T10:00:00.000Z"),
  eventStateId: "source-state-1",
  id: "source-state-1",
  sourceEventUid: SHARED_UID,
  startTime: new Date("2026-01-05T09:00:00.000Z"),
  summary: "Design review",
  ...overrides,
});

const materializeSource = (
  events: SyncableEvent[],
  window: SyncWindow = WINDOW,
): MaterializedSyncableEvent[] =>
  materializeRecurrenceEvents(events, { end: window.timeMax, start: window.timeMin });

const occurrenceStarts = (events: MaterializedSyncableEvent[]): string[] =>
  events.map((event) => event.startTime.toISOString());

const mentions = (condition: unknown, needle: string): boolean => {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): boolean => {
    if (node === needle) {
      return true;
    }
    if (typeof node !== "object" || node === null || visited.has(node)) {
      return false;
    }
    visited.add(node);
    return Object.values(node).some((value) => walk(value));
  };

  return walk(condition);
};

describe("a one-off event both calendars were invited to", () => {
  it("suppresses the mirror when the UID and both instants match", async () => {
    const index = await buildIndex([createNativeRow()]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });

  it.each([
    {
      name: "start",
      overrides: { startTime: new Date("2026-01-05T09:00:01.000Z") },
    },
    {
      name: "end",
      overrides: { endTime: new Date("2026-01-05T10:00:01.000Z") },
    },
  ])("pushes the mirror when the native $name is a whole second away", async ({ overrides }) => {
    const index = await buildIndex([createNativeRow(overrides)]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(result.events).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
  });

  it("pushes the mirror when a different UID occupies the same instants", async () => {
    const index = await buildIndex([createNativeRow({ sourceEventUid: "unrelated-uid" })]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(result.events).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * Truncated, never rounded: a copy the provider stored past the half second still names
   * the second the other copy sits in, and rounding it up would land the two on different
   * keys — the whole second of skew this granularity exists to absorb.
   */
  it.each([
    { milliseconds: "250", name: "short of the half second" },
    { milliseconds: "750", name: "past the half second" },
  ])("suppresses the mirror across sub-second skew $name", async ({ milliseconds }) => {
    const index = await buildIndex([createNativeRow({
      endTime: new Date(`2026-01-05T10:00:00.${milliseconds}Z`),
      startTime: new Date(`2026-01-05T09:00:00.${milliseconds}Z`),
    })]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });

  /*
   * A stored row is the destination's own proof it fetched that copy, whichever side of the
   * window's start the copy opens on.
   */
  it("suppresses a copy that was already running when the window opened", async () => {
    const overnight = {
      endTime: new Date("2026-01-01T02:00:00.000Z"),
      startTime: new Date("2025-12-31T22:00:00.000Z"),
    };
    const index = await buildIndex([createNativeRow(overnight)]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence(overnight)], index);

    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });

  it("suppresses an all-day copy the destination already holds", async () => {
    const wholeDay = {
      endTime: new Date("2026-01-14T00:00:00.000Z"),
      startTime: new Date("2026-01-13T00:00:00.000Z"),
    };
    const index = await buildIndex([createNativeRow({ ...wholeDay, isAllDay: true })]);

    const result = filterNativeDuplicateOccurrences(
      [createSourceOccurrence({ ...wholeDay, isAllDay: true })],
      index,
    );

    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });
});

describe("a recurring series both calendars were invited to", () => {
  const MOVED_SLOT = new Date("2026-01-12T09:00:00.000Z");
  const MOVED_START = new Date("2026-01-12T14:00:00.000Z");
  const MOVED_END = new Date("2026-01-12T15:00:00.000Z");

  const sourceSeries = (): MaterializedSyncableEvent[] =>
    materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

  it("suppresses every occurrence the native series expands to", async () => {
    const index = await buildIndex([createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE })]);
    const events = sourceSeries();

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(4);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  it("pushes only the occurrence the destination declined", async () => {
    const declined = new Date("2026-01-19T09:00:00.000Z");
    const index = await buildIndex([createNativeRow({
      exceptionDates: JSON.stringify([{ date: declined }]),
      recurrenceRule: STORED_WEEKLY_RULE,
    })]);

    const result = filterNativeDuplicateOccurrences(sourceSeries(), index);

    expect(occurrenceStarts(result.events)).toEqual([declined.toISOString()]);
    expect(result.suppressedCount).toBe(3);
  });

  it("pushes the original slot when only the native copy detached an override", async () => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
      createNativeRow({
        endTime: MOVED_END,
        id: "native-state-2",
        recurrenceId: MOVED_SLOT,
        startTime: MOVED_START,
      }),
    ]);

    const result = filterNativeDuplicateOccurrences(sourceSeries(), index);

    expect(occurrenceStarts(result.events)).toEqual([MOVED_SLOT.toISOString()]);
    expect(result.suppressedCount).toBe(3);
  });

  it("suppresses an override both copies moved to the same instant", async () => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
      createNativeRow({
        endTime: MOVED_END,
        id: "native-state-2",
        recurrenceId: MOVED_SLOT,
        startTime: MOVED_START,
      }),
    ]);
    const events = materializeSource([
      createSourceMaster({ recurrenceRule: WEEKLY_RULE }),
      createSourceMaster({
        endTime: MOVED_END,
        eventStateId: "source-state-2",
        id: "source-state-2",
        recurrenceId: MOVED_SLOT,
        startTime: MOVED_START,
      }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(4);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  it("keeps indexing a series whose only override sits before the window", async () => {
    const opened = {
      endTime: new Date("2025-11-03T10:00:00.000Z"),
      startTime: new Date("2025-11-03T09:00:00.000Z"),
    };
    const index = await buildIndex([
      createNativeRow({ ...opened, recurrenceRule: STORED_ENDLESS_WEEKLY_RULE }),
      createNativeRow({
        endTime: new Date("2025-11-11T15:00:00.000Z"),
        id: "native-state-2",
        recurrenceId: new Date("2025-11-10T09:00:00.000Z"),
        startTime: new Date("2025-11-11T14:00:00.000Z"),
      }),
    ]);
    const events = materializeSource([
      createSourceMaster({ ...opened, recurrenceRule: { frequency: "WEEKLY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(4);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  it("keeps indexing a series whose only override sits beyond the window", async () => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_ENDLESS_WEEKLY_RULE }),
      createNativeRow({
        endTime: new Date("2026-03-09T15:00:00.000Z"),
        id: "native-state-2",
        recurrenceId: new Date("2026-03-09T09:00:00.000Z"),
        startTime: new Date("2026-03-09T14:00:00.000Z"),
      }),
    ]);

    const result = filterNativeDuplicateOccurrences(sourceSeries(), index);

    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });
});

/*
 * Both copies expand their own rule, so the index only lines up with the source's
 * occurrences while the native rows carry everything that decides how the destination's
 * expansion runs. Across a daylight transition the zone and the all-day flag each move
 * every later occurrence by an hour, which is a whole-second difference the key sees.
 */
describe("a native series stored in a zone that observes daylight saving", () => {
  it("suppresses the occurrences that hold their wall time across the transition", async () => {
    const zoned = {
      endTime: new Date("2026-02-23T15:00:00.000Z"),
      startTime: new Date("2026-02-23T14:00:00.000Z"),
      startTimeZone: DAYLIGHT_ZONE,
    };
    const index = await buildIndex(
      [createNativeRow({ ...zoned, recurrenceRule: STORED_WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );
    const events = materializeSource(
      [createSourceMaster({ ...zoned, recurrenceRule: WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-02-23T14:00:00.000Z",
      "2026-03-02T14:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
      "2026-03-16T13:00:00.000Z",
    ]);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  it("suppresses an all-day series the destination stored at local midnight", async () => {
    const localMidnight = {
      endTime: new Date("2026-03-06T05:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-05T05:00:00.000Z"),
      startTimeZone: DAYLIGHT_ZONE,
    };
    const index = await buildIndex(
      [createNativeRow({ ...localMidnight, recurrenceRule: STORED_WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );
    const events = materializeSource(
      [createSourceMaster({ ...localMidnight, recurrenceRule: WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-03-05T05:00:00.000Z",
      "2026-03-12T05:00:00.000Z",
      "2026-03-19T05:00:00.000Z",
      "2026-03-26T05:00:00.000Z",
    ]);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });
});

describe("native data that must never suppress a mirror", () => {
  /*
   * A weekly series whose last slot inside the window sits two hours below its end, so a
   * reference re-anchored forward off that slot lands past the window entirely.
   */
  const UPPER_EDGE_SERIES = {
    endTime: new Date("2026-01-03T23:00:00.000Z"),
    startTime: new Date("2026-01-03T22:00:00.000Z"),
  };

  it("withholds a series that cannot be expanded within the occurrence budget", async () => {
    const index = await buildIndex([createNativeRow({
      recurrenceRule: STORED_SECONDLY_RULE,
    })]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
  });

  it("withholds a series stored as two masters, which cannot place its overrides", async () => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
      createNativeRow({ id: "native-state-2", recurrenceRule: STORED_WEEKLY_RULE }),
    ]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  it("never counts a Keeper-authored mirror as a native copy", async () => {
    const keeperUid = `0123456789abcdef${KEEPER_EVENT_SUFFIX}`;
    const index = await buildIndex([createNativeRow({ sourceEventUid: keeperUid })]);

    const result = filterNativeDuplicateOccurrences(
      [createSourceOccurrence({ sourceEventUid: keeperUid })],
      index,
    );

    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.suppressedCount).toBe(0);
  });

  it("skips rows with no source event UID without dropping the rest", async () => {
    const index = await buildIndex([
      createNativeRow({ id: "native-state-unidentified", sourceEventUid: null }),
      createNativeRow(),
    ]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(index.occurrenceKeys.size).toBe(1);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });

  it.each([
    { name: "recurrenceRule that is not JSON", overrides: { recurrenceRule: "{not json" } },
    {
      name: "recurrenceRule missing its frequency",
      overrides: { recurrenceRule: JSON.stringify({ count: 3 }) },
    },
    {
      name: "recurrenceRule naming an unknown frequency",
      overrides: { recurrenceRule: JSON.stringify({ frequency: "FORTNIGHTLY" }) },
    },
    {
      name: "exceptionDates stored in a legacy shape",
      overrides: {
        exceptionDates: JSON.stringify(["2026-01-12T09:00:00.000Z"]),
        recurrenceRule: STORED_WEEKLY_RULE,
      },
    },
  ])("keeps indexing the rest around an unparseable $name", async ({ overrides }) => {
    const index = await buildIndex([
      createNativeRow({
        id: "native-state-unparseable",
        sourceEventUid: "unparseable-uid",
        ...overrides,
      }),
      createNativeRow(),
    ]);

    const result = filterNativeDuplicateOccurrences([createSourceOccurrence()], index);

    expect(index.withheldSeriesUids.has("unparseable-uid")).toBe(true);
    expect(index.occurrenceKeys.size).toBe(1);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(1);
  });

  it("withholds the whole series when one of its rows cannot be parsed", async () => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
      createNativeRow({
        exceptionDates: "{not json",
        id: "native-state-2",
        recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
        startTime: new Date("2026-01-12T14:00:00.000Z"),
      }),
    ]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * A provider that rounds or re-anchors RECURRENCE-ID leaves an override whose slot the
   * master's expansion never names, so the moved instance is emitted at its new time while
   * the original slot stays in the expansion — the phantom the destination has vacated.
   */
  it.each([
    {
      name: "rounded to a different sub-second value",
      overrides: { recurrenceId: new Date("2026-01-12T09:00:00.500Z") },
    },
    {
      name: "anchored an hour away from every expanded slot",
      overrides: { recurrenceId: new Date("2026-01-12T08:00:00.000Z") },
    },
  ])("withholds a series holding an override $name", async ({ overrides }) => {
    const index = await buildIndex([
      createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
      createNativeRow({
        endTime: new Date("2026-01-12T15:00:00.000Z"),
        id: "native-state-2",
        startTime: new Date("2026-01-12T14:00:00.000Z"),
        ...overrides,
      }),
    ]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * A reference landing inside the interval below the first slot the index admits is still
   * within reach of it: nothing separates a provider that rounded this one off the slot the
   * window opens over from one that re-anchored it off the admitted slot above, and taking
   * the second guess would leave the index claiming an instant the destination has vacated.
   */
  it("withholds a series whose unplaceable override sits just below the first admitted slot", async () => {
    const overnight = {
      endTime: new Date("2026-01-01T01:00:00.000Z"),
      startTime: new Date("2025-12-31T23:00:00.000Z"),
    };
    const index = await buildIndex([
      createNativeRow({ ...overnight, recurrenceRule: STORED_DAILY_RULE }),
      createNativeRow({
        endTime: new Date("2026-01-06T17:00:00.000Z"),
        id: "native-state-2",
        recurrenceId: new Date("2025-12-31T23:00:00.500Z"),
        startTime: new Date("2026-01-06T15:00:00.000Z"),
      }),
    ]);
    const events = materializeSource([
      createSourceMaster({ ...overnight, recurrenceRule: DAILY_RULE }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toContain("2025-12-31T23:00:00.000Z");
    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(5);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * The index admits no slot below the window's start, so a reference that lands a whole
   * interval below the first one it does admit can have vacated none of them: whichever slot
   * the destination detached there is one nothing in the index claims, and withholding the
   * series would cost every in-window occurrence it answers for.
   */
  it("keeps indexing a series whose unplaceable override sits below every slot it admits", async () => {
    const overnight = {
      endTime: new Date("2026-01-01T02:00:00.000Z"),
      startTime: new Date("2025-12-31T22:00:00.000Z"),
    };
    const index = await buildIndex([
      createNativeRow({ ...overnight, recurrenceRule: STORED_ENDLESS_WEEKLY_RULE }),
      createNativeRow({
        endTime: new Date("2026-01-15T11:00:00.000Z"),
        id: "native-state-2",
        recurrenceId: new Date("2025-12-31T21:59:00.000Z"),
        startTime: new Date("2026-01-15T10:00:00.000Z"),
      }),
    ]);
    const events = materializeSource([
      createSourceMaster({ ...overnight, recurrenceRule: { frequency: "WEEKLY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(5);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(occurrenceStarts(result.events)).toEqual(["2025-12-31T22:00:00.000Z"]);
    expect(result.suppressedCount).toBe(4);
  });

  /*
   * The same mis-anchoring at the window's upper edge, where it costs the most: the slot the
   * reference was meant to vacate stays below timeMax and is therefore indexed, so the copy
   * the destination declined or moved is the very occurrence suppression would hide.
   */
  it.each([
    {
      name: "declined date re-anchored past the window's end",
      rows: [createNativeRow({
        ...UPPER_EDGE_SERIES,
        exceptionDates: JSON.stringify([{ date: new Date("2026-02-01T03:00:00.000Z") }]),
        recurrenceRule: STORED_ENDLESS_WEEKLY_RULE,
      })],
    },
    {
      name: "declined date anchored exactly on the window's end",
      rows: [createNativeRow({
        ...UPPER_EDGE_SERIES,
        exceptionDates: JSON.stringify([{ date: new Date("2026-02-01T00:00:00.000Z") }]),
        recurrenceRule: STORED_ENDLESS_WEEKLY_RULE,
      })],
    },
    {
      name: "override re-anchored past the window's end",
      rows: [
        createNativeRow({ ...UPPER_EDGE_SERIES, recurrenceRule: STORED_ENDLESS_WEEKLY_RULE }),
        createNativeRow({
          endTime: new Date("2026-01-28T11:00:00.000Z"),
          id: "native-state-2",
          recurrenceId: new Date("2026-02-01T03:00:00.000Z"),
          startTime: new Date("2026-01-28T10:00:00.000Z"),
        }),
      ],
    },
  ])("withholds a series holding a $name", async ({ rows }) => {
    const index = await buildIndex(rows);
    const events = materializeSource([
      createSourceMaster({ ...UPPER_EDGE_SERIES, recurrenceRule: { frequency: "WEEKLY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toContain("2026-01-31T22:00:00.000Z");
    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(5);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * The occurrence the window stops short of is still one the rule produces, so a date
   * declining it is placed rather than mis-anchored, and every slot the window does cover
   * keeps answering for the destination.
   */
  it("keeps indexing a series whose declined date lands on the first slot past the window", async () => {
    const closing = {
      endTime: new Date("2026-01-30T10:00:00.000Z"),
      startTime: new Date("2026-01-30T09:00:00.000Z"),
    };
    const index = await buildIndex([createNativeRow({
      ...closing,
      exceptionDates: JSON.stringify([{ date: new Date("2026-02-01T09:00:00.000Z") }]),
      recurrenceRule: STORED_ENDLESS_DAILY_RULE,
    })]);
    const events = materializeSource([
      createSourceMaster({ ...closing, recurrenceRule: { frequency: "DAILY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-01-30T09:00:00.000Z",
      "2026-01-31T09:00:00.000Z",
    ]);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(2);
  });

  /*
   * The mirror image of the floor: the slot that date is an hour off is one the window falls
   * short of, so the index never claimed it, and no slot the index does claim sits within a
   * day of where the date landed.
   */
  it("keeps indexing a series whose declined date sits an hour off the slot past the window", async () => {
    const closing = {
      endTime: new Date("2026-01-30T10:00:00.000Z"),
      startTime: new Date("2026-01-30T09:00:00.000Z"),
    };
    const index = await buildIndex([createNativeRow({
      ...closing,
      exceptionDates: JSON.stringify([{ date: new Date("2026-02-01T10:00:00.000Z") }]),
      recurrenceRule: STORED_ENDLESS_DAILY_RULE,
    })]);
    const events = materializeSource([
      createSourceMaster({ ...closing, recurrenceRule: { frequency: "DAILY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(2);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(2);
  });

  /*
   * A declined date a whole interval out lands past where the masters are expanded, so the
   * slot it names is one the expansion cannot show — but the stretch a re-anchored reference
   * could have reached still covers it, since that stretch opens an interval past the last
   * slot. Only the expansion's own ceiling separates the two: beyond it a date is taken as
   * declining an occurrence the window falls short of, never as a reference mis-anchored off
   * a slot inside it, because no indexed slot sits within a day of where this one landed.
   */
  it("keeps indexing a series whose declined date lands an interval past the window", async () => {
    const index = await buildIndex([createNativeRow({
      exceptionDates: JSON.stringify([{ date: new Date("2026-02-02T09:00:00.000Z") }]),
      recurrenceRule: STORED_ENDLESS_WEEKLY_RULE,
    })]);
    const events = materializeSource([
      createSourceMaster({ recurrenceRule: { frequency: "WEEKLY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T09:00:00.000Z",
      "2026-01-19T09:00:00.000Z",
      "2026-01-26T09:00:00.000Z",
    ]);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(index.occurrenceKeys.size).toBe(4);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  /*
   * The window's start is the destination's verified coverage, and the expansion opens a
   * duration before it. A slot the rule produces in that band is an inference no row backs:
   * an instance the destination detached and moved clear of its own ingest window was never
   * written to event_states, so nothing contradicts the master still naming the slot it
   * vacated — and unlike a mis-anchored reference, an absent row leaves no claim to withhold
   * the series on. Only slots the window itself covers can answer for the destination.
   */
  it("never indexes a slot the expansion reaches below the window", async () => {
    const overnight = {
      endTime: new Date("2026-01-01T02:00:00.000Z"),
      startTime: new Date("2025-12-31T22:00:00.000Z"),
    };
    const index = await buildIndex([
      createNativeRow({ ...overnight, recurrenceRule: STORED_ENDLESS_WEEKLY_RULE }),
    ]);
    const events = materializeSource([
      createSourceMaster({ ...overnight, recurrenceRule: { frequency: "WEEKLY" } }),
    ]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(5);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(occurrenceStarts(result.events)).toEqual(["2025-12-31T22:00:00.000Z"]);
    expect(result.suppressedCount).toBe(4);
  });

  it("withholds an all-day series whose override is dated at UTC midnight", async () => {
    const localMidnight = {
      endTime: new Date("2026-03-06T05:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-05T05:00:00.000Z"),
      startTimeZone: DAYLIGHT_ZONE,
    };
    const index = await buildIndex(
      [
        createNativeRow({ ...localMidnight, recurrenceRule: STORED_WEEKLY_RULE }),
        createNativeRow({
          ...localMidnight,
          endTime: new Date("2026-03-14T05:00:00.000Z"),
          id: "native-state-2",
          recurrenceId: new Date("2026-03-12T00:00:00.000Z"),
          startTime: new Date("2026-03-13T05:00:00.000Z"),
        }),
      ],
      DAYLIGHT_WINDOW,
    );
    const events = materializeSource(
      [createSourceMaster({ ...localMidnight, recurrenceRule: WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  it("withholds an all-day series whose declined date is anchored at UTC midnight", async () => {
    const localMidnight = {
      endTime: new Date("2026-03-06T05:00:00.000Z"),
      isAllDay: true,
      startTime: new Date("2026-03-05T05:00:00.000Z"),
      startTimeZone: DAYLIGHT_ZONE,
    };
    const index = await buildIndex(
      [createNativeRow({
        ...localMidnight,
        exceptionDates: JSON.stringify([{ date: new Date("2026-03-12T00:00:00.000Z") }]),
        recurrenceRule: STORED_WEEKLY_RULE,
      })],
      DAYLIGHT_WINDOW,
    );
    const events = materializeSource(
      [createSourceMaster({ ...localMidnight, recurrenceRule: WEEKLY_RULE })],
      DAYLIGHT_WINDOW,
    );

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  it("withholds a series whose declined date is an hour away from every expanded slot", async () => {
    const index = await buildIndex([createNativeRow({
      exceptionDates: JSON.stringify([{ date: new Date("2026-01-19T08:00:00.000Z") }]),
      recurrenceRule: STORED_WEEKLY_RULE,
    })]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.occurrenceKeys.size).toBe(0);
    expect(result.events).toHaveLength(4);
    expect(result.suppressedCount).toBe(0);
  });

  /*
   * A withheld series is the whole cost of the row that caused it: the destination holds
   * hundreds of native series, and one provider-mangled row must not stop the index from
   * answering for any of the others.
   */
  it.each([
    {
      name: "stored as two masters",
      rows: [
        createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
        createNativeRow({ id: "native-state-2", recurrenceRule: STORED_WEEKLY_RULE }),
      ],
    },
    {
      name: "holding an override no expanded slot can place",
      rows: [
        createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
        createNativeRow({
          endTime: new Date("2026-01-12T15:00:00.000Z"),
          id: "native-state-2",
          recurrenceId: new Date("2026-01-12T08:00:00.000Z"),
          startTime: new Date("2026-01-12T14:00:00.000Z"),
        }),
      ],
    },
    {
      name: "holding a row that cannot be parsed",
      rows: [
        createNativeRow({ recurrenceRule: STORED_WEEKLY_RULE }),
        createNativeRow({
          exceptionDates: "{not json",
          id: "native-state-2",
          recurrenceId: new Date("2026-01-12T09:00:00.000Z"),
          startTime: new Date("2026-01-12T14:00:00.000Z"),
        }),
      ],
    },
    {
      name: "that cannot be expanded within the occurrence budget",
      rows: [createNativeRow({ recurrenceRule: STORED_SECONDLY_RULE })],
    },
  ])("keeps suppressing an unrelated series beside one withheld $name", async ({ rows }) => {
    const unrelated = {
      endTime: new Date("2026-01-06T10:00:00.000Z"),
      startTime: new Date("2026-01-06T09:00:00.000Z"),
    };
    const unrelatedDeclined = new Date("2026-01-13T09:00:00.000Z");
    const index = await buildIndex([
      ...rows,
      createNativeRow({
        ...unrelated,
        exceptionDates: JSON.stringify([{ date: unrelatedDeclined }]),
        id: "native-state-unrelated",
        recurrenceRule: STORED_WEEKLY_RULE,
        sourceEventUid: "unrelated-uid",
      }),
    ]);
    const events = [
      ...materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]),
      ...materializeSource([createSourceMaster({
        ...unrelated,
        eventStateId: "source-state-unrelated",
        exceptionDates: [unrelatedDeclined],
        id: "source-state-unrelated",
        recurrenceRule: WEEKLY_RULE,
        sourceEventUid: "unrelated-uid",
      })]),
    ];

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.withheldSeriesUids.has(SHARED_UID)).toBe(true);
    expect(index.withheldSeriesUids.has("unrelated-uid")).toBe(false);
    expect(occurrenceStarts(result.events)).toEqual(
      occurrenceStarts(materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })])),
    );
    expect(result.suppressedCount).toBe(3);
  });

  /*
   * The lookback a mis-anchored reference is measured against belongs to its own series. A
   * longer series sharing the calendar reaches further back for its own sake, but it adds no
   * stretch in which this one's expansion has a slot to be displaced from.
   */
  it("measures an unplaceable reference against its own series' lookback", async () => {
    const overnight = {
      endTime: new Date("2026-01-03T02:00:00.000Z"),
      startTime: new Date("2026-01-02T18:00:00.000Z"),
    };
    const index = await buildIndex([
      createNativeRow({
        exceptionDates: JSON.stringify([{ date: new Date("2025-12-31T20:00:00.000Z") }]),
        recurrenceRule: STORED_WEEKLY_RULE,
      }),
      createNativeRow({
        ...overnight,
        exceptionDates: JSON.stringify([{ date: new Date("2026-01-03T18:00:00.000Z") }]),
        id: "native-state-2",
        recurrenceRule: STORED_DAILY_RULE,
        sourceEventUid: "overnight-uid",
      }),
    ]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: WEEKLY_RULE })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(4);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  it("keeps indexing a series whose only declined date sits before the window", async () => {
    const index = await buildIndex([createNativeRow({
      endTime: new Date("2025-11-03T10:00:00.000Z"),
      exceptionDates: JSON.stringify([{ date: new Date("2025-11-10T08:30:00.000Z") }]),
      recurrenceRule: STORED_ENDLESS_WEEKLY_RULE,
      startTime: new Date("2025-11-03T09:00:00.000Z"),
    })]);
    const events = materializeSource([createSourceMaster({
      endTime: new Date("2025-11-03T10:00:00.000Z"),
      recurrenceRule: { frequency: "WEEKLY" },
      startTime: new Date("2025-11-03T09:00:00.000Z"),
    })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toHaveLength(4);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(4);
  });

  /*
   * A rule shortened by COUNT or UNTIL leaves the declined dates of the occurrences it no
   * longer reaches behind it. One naming a position the rule never produces cannot be the
   * twin of a slot that is indexed, so the series keeps answering for the slots it holds.
   */
  it("keeps indexing a series whose declined date sits past the last slot its rule produces", async () => {
    const shortened = { count: 2, frequency: "WEEKLY" } as const;
    const index = await buildIndex([createNativeRow({
      exceptionDates: JSON.stringify([{ date: new Date("2026-01-26T09:00:00.000Z") }]),
      recurrenceRule: JSON.stringify(shortened),
    })]);
    const events = materializeSource([createSourceMaster({ recurrenceRule: shortened })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T09:00:00.000Z",
    ]);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(2);
  });

  it("keeps indexing a series whose declined date predates the slot it opens on", async () => {
    const opened = {
      endTime: new Date("2026-01-20T10:00:00.000Z"),
      startTime: new Date("2026-01-20T09:00:00.000Z"),
    };
    const index = await buildIndex([createNativeRow({
      ...opened,
      exceptionDates: JSON.stringify([{ date: new Date("2026-01-06T09:00:00.000Z") }]),
      recurrenceRule: STORED_ENDLESS_WEEKLY_RULE,
    })]);
    const events = materializeSource([createSourceMaster({
      ...opened,
      recurrenceRule: { frequency: "WEEKLY" },
    })]);

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(occurrenceStarts(events)).toEqual([
      "2026-01-20T09:00:00.000Z",
      "2026-01-27T09:00:00.000Z",
    ]);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.suppressedCount).toBe(2);
  });

  it("suppresses nothing when the destination has not been ingested yet", async () => {
    const index = await buildIndex([]);
    const events = [createSourceOccurrence()];

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(index.occurrenceKeys.size).toBe(0);
    expect(index.withheldSeriesUids.size).toBe(0);
    expect(result.events).toEqual(events);
    expect(result.suppressedCount).toBe(0);
  });

  it("reports nothing suppressed when there is nothing to mirror", async () => {
    const index = await buildIndex([createNativeRow()]);

    expect(filterNativeDuplicateOccurrences([], index)).toEqual({
      events: [],
      suppressedCount: 0,
    });
  });
});

describe("filterNativeDuplicateOccurrences", () => {
  it("leaves the given list untouched and keeps the surviving order", async () => {
    const index = await buildIndex([createNativeRow()]);
    const events = [
      createSourceOccurrence({
        eventStateId: "source-state-2",
        id: "source-state-2",
        sourceEventUid: "unrelated-uid",
      }),
      createSourceOccurrence(),
      createSourceOccurrence({
        endTime: new Date("2026-01-20T10:00:00.000Z"),
        eventStateId: "source-state-3",
        id: "source-state-3",
        startTime: new Date("2026-01-20T09:00:00.000Z"),
      }),
    ];
    const snapshot = [...events];

    const result = filterNativeDuplicateOccurrences(events, index);

    expect(events).toEqual(snapshot);
    expect(result.events.map((event) => event.id)).toEqual([
      "source-state-2",
      "source-state-3",
    ]);
    expect(result.suppressedCount).toBe(1);
  });
});

describe("the native event_states read", () => {
  it("narrows the read to the destination calendar", async () => {
    const wheres: unknown[] = [];

    await getNativeOccurrenceIndex(
      createNativeDatabase([], wheres),
      DESTINATION_CALENDAR_ID,
      WINDOW,
    );

    expect(wheres).toHaveLength(1);
    expect(mentions(wheres[0], DESTINATION_CALENDAR_ID)).toBe(true);
  });

  it("never applies the destination's own outbound sync exclusions", async () => {
    const source = await Bun.file(
      `${import.meta.dirname}/../../../src/core/events/native-duplicates.ts`,
    ).text();

    expect(source).toContain("eventStatesTable");
    expect(source).not.toContain("calendarsTable");
    expect(source).not.toContain("shouldExcludeSyncEvent");
    expect(source).not.toContain("getEventsForCalendarsWithDiagnostics");
  });
});
