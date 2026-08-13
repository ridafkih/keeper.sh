import { afterEach, describe, expect, it } from "vitest";
import { ingestSource } from "../../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../../src/core/types";
import { createGoogleSourceFetcher } from "../../../../src/providers/google/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);
const CALENDAR_ID = "google-calendar";

const originalFetch = globalThis.fetch;

interface GoogleItem {
  end?: { date?: string; dateTime?: string; timeZone?: string };
  iCalUID?: string;
  id?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  status?: "cancelled" | "confirmed" | "tentative";
  summary?: string;
  updated?: string;
}

const answerWith = (items: GoogleItem[], syncToken = "token-next"): void => {
  const stub = (): Promise<Response> =>
    Promise.resolve(Response.json({ items, nextSyncToken: syncToken }));
  stub.preconnect = originalFetch.preconnect;
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
};

const DISCARD_KEYS = [
  "source_events.discarded_outside_window",
  "source_events.discarded_unrepresentable",
  "source_events.skipped_resources",
  "source_events.skipped_self_authored",
  "source_events.unsupported_count",
];

const discardTotal = (wideEvent: IngestWideEventFields): number => {
  let total = 0;
  for (const key of DISCARD_KEYS) {
    const value = wideEvent[key];
    if (typeof value === "number") {
      total += value;
    }
  }
  return total;
};

const storedId = (event: SourceEvent): string => `state-${event.sourceEventId ?? event.uid}`;

const toStoredState = (event: SourceEvent): StoredSourceEventState => ({
  availability: event.availability ?? null,
  description: event.description ?? null,
  endTime: event.endTime,
  exceptionDates: null,
  id: storedId(event),
  isAllDay: event.isAllDay ?? null,
  location: event.location ?? null,
  recurrenceId: event.recurrenceId ?? null,
  recurrenceRule: null,
  sourceEventId: event.sourceEventId ?? null,
  sourceEventType: event.sourceEventType ?? null,
  sourceEventUid: event.uid,
  startTime: event.startTime,
  startTimeZone: event.startTimeZone ?? null,
  title: event.title ?? null,
});

const createStore = () => {
  let rows: StoredSourceEventState[] = [];
  return {
    apply: (inserts: SourceEvent[], deletes: string[]): void => {
      const removed = new Set(deletes);
      const upserted = inserts.map((event) => toStoredState(event));
      const replaced = new Set(upserted.map(({ id }) => id));
      rows = [
        ...rows.filter((row) => !removed.has(row.id) && !replaced.has(row.id)),
        ...upserted,
      ];
    },
    ids: (): string[] => rows.map(({ id }) => id).toSorted(),
    read: (): StoredSourceEventState[] => rows,
  };
};

interface RunOutcome {
  deletes: string[];
  inserts: string[];
  syncToken?: string | null;
  wideEvent: IngestWideEventFields;
}

const ingestGoogle = async (
  store: ReturnType<typeof createStore>,
  items: GoogleItem[],
  syncToken: string | null,
): Promise<RunOutcome> => {
  answerWith(items);
  const fetcher = createGoogleSourceFetcher({
    accessToken: "token",
    calendarId: CALENDAR_ID,
    externalCalendarId: "primary",
    plan: PLAN,
    syncToken,
  });
  const outcome: RunOutcome = { deletes: [], inserts: [], wideEvent: {} };

  await ingestSource({
    calendarId: CALENDAR_ID,
    fetchEvents: () => fetcher.fetchEvents(),
    flush: (changes) => {
      outcome.deletes.push(...changes.deletes);
      outcome.inserts.push(...changes.inserts.map((event) => storedId(event)));
      outcome.syncToken = changes.syncToken;
      store.apply(changes.inserts, changes.deletes);
      return Promise.resolve();
    },
    onIngestEvent: (event) => {
      outcome.wideEvent = { ...event };
    },
    readExistingEvents: () => Promise.resolve(store.read()),
  });

  return outcome;
};

const STANDUP: GoogleItem = {
  end: { dateTime: "2026-06-20T09:30:00.000Z", timeZone: "UTC" },
  iCalUID: "standup@example.com",
  id: "google-standup",
  start: { dateTime: "2026-06-20T09:00:00.000Z", timeZone: "UTC" },
  status: "confirmed",
  summary: "Standup",
  updated: "2026-06-01T00:00:00.000Z",
};

const DINNER: GoogleItem = {
  end: { dateTime: "2026-06-21T20:00:00.000Z", timeZone: "UTC" },
  iCalUID: "dinner@example.com",
  id: "google-dinner",
  start: { dateTime: "2026-06-21T19:00:00.000Z", timeZone: "UTC" },
  status: "confirmed",
  summary: "Dinner",
  updated: "2026-06-01T00:00:00.000Z",
};

const seedFullSync = async (store: ReturnType<typeof createStore>): Promise<RunOutcome> => {
  const first = await ingestGoogle(store, [STANDUP, DINNER], null);
  expect(first.inserts.toSorted()).toEqual(["state-google-dinner", "state-google-standup"]);
  return first;
};

const deltaToken = (seeded: RunOutcome): string => {
  const { syncToken } = seeded;
  if (typeof syncToken !== "string") {
    throw new TypeError("The seeding full sync must persist a sync token");
  }
  return syncToken;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Google delta discards", () => {
  it("counts a changed event the provider stopped giving an iCalUID", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const second = await ingestGoogle(
      store,
      [{ ...DINNER, iCalUID: globalThis.undefined, updated: "2026-06-10T00:00:00.000Z" }],
      deltaToken(seeded),
    );

    expect(second.deletes).toEqual(["state-google-dinner"]);
    expect(second.wideEvent["events.removed"]).toBe(1);
    expect(discardTotal(second.wideEvent)).toBeGreaterThan(0);
  });

  it("counts a changed event the provider stopped giving a start", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const second = await ingestGoogle(
      store,
      [{ ...DINNER, start: globalThis.undefined, updated: "2026-06-10T00:00:00.000Z" }],
      deltaToken(seeded),
    );

    expect(second.deletes).toEqual(["state-google-dinner"]);
    expect(discardTotal(second.wideEvent)).toBeGreaterThan(0);
  });

  it("counts a changed event that moved outside the sync window", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const second = await ingestGoogle(
      store,
      [{
        ...DINNER,
        end: { dateTime: "2029-06-21T20:00:00.000Z", timeZone: "UTC" },
        start: { dateTime: "2029-06-21T19:00:00.000Z", timeZone: "UTC" },
        updated: "2026-06-10T00:00:00.000Z",
      }],
      deltaToken(seeded),
    );

    expect(second.deletes).toEqual(["state-google-dinner"]);
    expect(second.wideEvent["source_events.discarded_outside_window"]).toBe(1);
  });

  it("counts a changed event whose iCalUID became Keeper-authored", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const second = await ingestGoogle(
      store,
      [{ ...DINNER, iCalUID: "mirrored@keeper.sh", updated: "2026-06-10T00:00:00.000Z" }],
      deltaToken(seeded),
    );

    expect(second.deletes).toEqual(["state-google-dinner"]);
    expect(discardTotal(second.wideEvent)).toBeGreaterThan(0);
  });

  it("counts a changed event that ends exactly on the window's lower edge", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);
    const { timeMin } = PLAN.window;

    const second = await ingestGoogle(
      store,
      [{
        ...DINNER,
        end: { dateTime: timeMin.toISOString(), timeZone: "UTC" },
        start: { dateTime: new Date(timeMin.getTime() - 3_600_000).toISOString(), timeZone: "UTC" },
        updated: "2026-06-10T00:00:00.000Z",
      }],
      deltaToken(seeded),
    );

    expect(second.deletes).toEqual(["state-google-dinner"]);
    expect(second.wideEvent["source_events.discarded_outside_window"]).toBe(1);
  });

  it("settles after a discard-driven deletion instead of churning", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);
    let token = deltaToken(seeded);

    const dropped = await ingestGoogle(
      store,
      [{ ...DINNER, iCalUID: globalThis.undefined, updated: "2026-06-10T00:00:00.000Z" }],
      token,
    );
    expect(dropped.deletes).toEqual(["state-google-dinner"]);
    if (typeof dropped.syncToken === "string") {
      token = dropped.syncToken;
    }

    for (let run = 0; run < 3; run += 1) {
      const quiet = await ingestGoogle(store, [], token);
      expect(quiet.inserts).toEqual([]);
      expect(quiet.deletes).toEqual([]);
      if (typeof quiet.syncToken === "string") {
        token = quiet.syncToken;
      }
    }

    expect(store.ids()).toEqual(["state-google-standup"]);
  });

  it("keeps repeated full syncs of the same feed free of add/remove churn", async () => {
    const store = createStore();
    await seedFullSync(store);

    for (let run = 0; run < 3; run += 1) {
      const repeat = await ingestGoogle(store, [STANDUP, DINNER], null);
      expect(repeat.inserts).toEqual([]);
      expect(repeat.deletes).toEqual([]);
      expect(discardTotal(repeat.wideEvent)).toBe(0);
    }

    expect(store.ids()).toEqual(["state-google-dinner", "state-google-standup"]);
  });

  it("does not let one timeless event fail the whole calendar's ingest", async () => {
    const store = createStore();
    await seedFullSync(store);

    const outcome = await ingestGoogle(
      store,
      [STANDUP, DINNER, {
        end: { timeZone: "UTC" },
        iCalUID: "timeless@example.com",
        id: "google-timeless",
        start: { timeZone: "UTC" },
        status: "confirmed",
        summary: "Timeless",
        updated: "2026-06-10T00:00:00.000Z",
      }],
      null,
    ).catch((error: unknown) => error);

    expect(outcome).not.toBeInstanceOf(Error);
    expect(store.ids()).toEqual(["state-google-dinner", "state-google-standup"]);
  });
});
