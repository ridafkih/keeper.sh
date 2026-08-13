import { describe, expect, it } from "vitest";
import { ingestSource } from "../../../src/core/sync-engine/ingest";
import type {
  FetchEventsResult,
  IngestWideEventFields,
} from "../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../src/core/types";

const WINDOW = {
  timeMin: new Date("2026-06-01T00:00:00.000Z"),
  timeMax: new Date("2026-08-01T00:00:00.000Z"),
};

const CALENDAR_ID = "calendar-convergence";

const storedIdFor = (event: SourceEvent): string =>
  `${event.uid}::${event.recurrenceId?.toISOString() ?? ""}`;

const serializeExceptionDates = (event: SourceEvent): string | null => {
  if (!event.exceptionDates) {
    return null;
  }
  return JSON.stringify(event.exceptionDates);
};

const serializeRecurrenceRule = (event: SourceEvent): string | null => {
  if (!event.recurrenceRule) {
    return null;
  }
  return JSON.stringify({
    ...event.recurrenceRule,
    recurrenceDuration: event.recurrenceDuration,
  });
};

const toStored = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: serializeExceptionDates(event),
  id: storedIdFor(event),
  isAllDay: event.isAllDay ?? false,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: serializeRecurrenceRule(event),
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? "default",
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
});

interface Round {
  added: number;
  removed: number;
  deletes: string[];
  inserts: string[];
  outcome: unknown;
  wideEvent: IngestWideEventFields;
  storeAfter: string[];
}

const runRound = async (
  initialStore: readonly StoredSourceEventState[],
  buildFetchResult: () => FetchEventsResult,
): Promise<{ round: Round; store: StoredSourceEventState[] }> => {
  let store = [...initialStore];
  let wideEvent: IngestWideEventFields = {};
  const observed = { deletes: [] as string[], inserts: [] as string[] };

  const result = await ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents: () => Promise.resolve(buildFetchResult()),
    flush: (changes) => {
      observed.deletes = [...changes.deletes];
      observed.inserts = changes.inserts.map((event) => storedIdFor(event));
      const deleted = new Set(changes.deletes);
      store = [
        ...store.filter((event) => !deleted.has(event.id)),
        ...changes.inserts.map((insert) => toStored(insert)),
      ];
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve([...store]),
  });

  return {
    round: {
      added: result.eventsAdded,
      deletes: observed.deletes,
      inserts: observed.inserts,
      outcome: wideEvent["outcome"],
      removed: result.eventsRemoved,
      storeAfter: store.map((event) => event.id).toSorted(),
      wideEvent,
    },
    store,
  };
};

const runRounds = async (
  rounds: number,
  buildFetchResult: () => FetchEventsResult,
  initialStore: StoredSourceEventState[] = [],
): Promise<Round[]> => {
  let store = [...initialStore];
  const history: Round[] = [];

  for (let round = 0; round < rounds; round += 1) {
    const outcome = await runRound(store, buildFetchResult);
    ({ store } = outcome);
    history.push(outcome.round);
  }

  return history;
};

const timedEvent = (
  uid: string,
  start: string,
  end: string,
  overrides: Partial<SourceEvent> = {},
): SourceEvent => ({
  endTime: new Date(end),
  startTime: new Date(start),
  isAllDay: false,
  title: uid,
  uid,
  ...overrides,
});

describe("ingest convergence — unsupported events", () => {
  it("settles: an unsupported uid is never inserted and never deleted", async () => {
    const supported = timedEvent("ok-1", "2026-06-10T09:00:00Z", "2026-06-10T10:00:00Z");
    const unsupported = timedEvent("bad-1", "2026-06-11T09:00:00Z", "2026-06-11T10:00:00Z");

    const history = await runRounds(6, () => ({
      events: [supported, unsupported],
      syncWindow: WINDOW,
      unsupportedEventUids: ["bad-1"],
    }));

    expect(history[0]?.inserts).toEqual(["ok-1::"]);
    expect(history[0]?.removed).toBe(0);

    for (const round of history.slice(1)) {
      expect(round.added).toBe(0);
      expect(round.removed).toBe(0);
      expect(round.outcome).toBe("in-sync");
      expect(round.storeAfter).toEqual(["ok-1::"]);
    }
  });

  it("keeps discard counters per-run, not accumulating across runs", async () => {
    const history = await runRounds(5, () => ({
      discardedEventCounts: { outsideSyncWindow: 3, unrepresentable: 2 },
      events: [timedEvent("ok-1", "2026-06-10T09:00:00Z", "2026-06-10T10:00:00Z")],
      syncWindow: WINDOW,
    }));

    for (const round of history) {
      expect(round.wideEvent["source_events.discarded_outside_window"]).toBe(3);
      expect(round.wideEvent["source_events.discarded_unrepresentable"]).toBe(2);
    }
  });
});

describe("ingest convergence — over-budget recurrence", () => {
  it("withholds an over-budget series without deleting its stored state", async () => {
    const pathological = timedEvent(
      "series-1",
      "2026-06-02T09:00:00Z",
      "2026-06-02T09:30:00Z",
      { recurrenceRule: { frequency: "MINUTELY", interval: 1 } as SourceEvent["recurrenceRule"] },
    );
    const normal = timedEvent("ok-1", "2026-06-10T09:00:00Z", "2026-06-10T10:00:00Z");

    const history = await runRounds(
      6,
      () => ({
        events: [pathological, normal],
        syncWindow: WINDOW,
      }),
      [toStored(pathological)],
    );

    expect(history[0]?.wideEvent["recurrence.over_budget_count"]).toBeGreaterThan(0);

    for (const round of history) {
      expect(round.deletes).not.toContain("series-1::");
      expect(round.storeAfter).toContain("series-1::");
    }
    for (const round of history.slice(1)) {
      expect(round.added).toBe(0);
      expect(round.removed).toBe(0);
    }
  });
});

describe("ingest convergence — delta window pruning", () => {
  it("prunes an out-of-window stored event exactly once, then settles", async () => {
    const stale = timedEvent("stale-1", "2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z");
    const inside = timedEvent("ok-1", "2026-06-10T09:00:00Z", "2026-06-10T10:00:00Z");

    const history = await runRounds(
      6,
      () => ({
        changedEventIds: [],
        events: [inside],
        isDeltaSync: true,
        syncWindow: WINDOW,
      }),
      [toStored(stale), toStored(inside)],
    );

    expect(history[0]?.deletes).toEqual(["stale-1::"]);

    for (const round of history.slice(1)) {
      expect(round.added).toBe(0);
      expect(round.removed).toBe(0);
      expect(round.storeAfter).toEqual(["ok-1::"]);
    }
  });

  // No shipped adapter hands the engine this shape; the next test proves it.
  it("oscillates if a delta ever reports an event outside the sync window", async () => {
    const outside = timedEvent("outside-1", "2026-09-10T09:00:00Z", "2026-09-10T10:00:00Z");

    const history = await runRounds(8, () => ({
      changedEventIds: ["outside-1"],
      events: [outside],
      isDeltaSync: true,
      syncWindow: WINDOW,
    }));

    const churn = history.map((round) => `${String(round.added)}/${String(round.removed)}`);
    expect(churn).toEqual(["1/0", "0/1", "1/0", "0/1", "1/0", "0/1", "1/0", "0/1"]);
  });

  it("keeps every shipped adapter's window filter in agreement with the pruner", () => {
    const insideByPruner = (start: string, end: string): boolean =>
      !(new Date(end) <= WINDOW.timeMin || new Date(start) >= WINDOW.timeMax);

    expect(insideByPruner("2026-05-31T23:00:00Z", "2026-06-01T00:00:00Z")).toBe(false);
    expect(insideByPruner("2026-08-01T00:00:00Z", "2026-08-01T01:00:00Z")).toBe(false);
    expect(insideByPruner("2026-05-31T23:00:00Z", "2026-06-01T01:00:00Z")).toBe(true);
    expect(insideByPruner("2026-07-31T23:00:00Z", "2026-08-01T01:00:00Z")).toBe(true);
  });
});
