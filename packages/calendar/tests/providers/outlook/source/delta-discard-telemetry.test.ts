import { afterEach, describe, expect, it } from "vitest";
import { ingestSource } from "../../../../src/core/sync-engine/ingest";
import type { IngestWideEventFields } from "../../../../src/core/sync-engine/ingest";
import type { StoredSourceEventState } from "../../../../src/core/source/stored-event-state";
import type { SourceEvent } from "../../../../src/core/types";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const PLAN = createSourceIngestionPlan("1_month", "2_years", NOW);
const CALENDAR_ID = "outlook-calendar";

const originalFetch = globalThis.fetch;

interface OutlookItem {
  "@removed"?: { reason: string };
  categories?: string[];
  end?: { dateTime?: string; timeZone?: string };
  iCalUId?: string;
  id?: string;
  isCancelled?: boolean;
  lastModifiedDateTime?: string;
  start?: { dateTime?: string; timeZone?: string };
  subject?: string;
  type?: string;
}

const describeThrow = (error: unknown): string => {
  if (error instanceof Error) {
    return `throw:${error.message}`;
  }
  return "throw";
};

let deltaCallCount = 0;

const answerWith = (items: OutlookItem[], deltaLink: string): void => {
  deltaCallCount = 0;
  const stub = (): Promise<Response> => {
    deltaCallCount += 1;
    return Promise.resolve(Response.json({
      "@odata.deltaLink": deltaLink,
      value: items,
    }));
  };
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

const ingestOutlook = async (
  store: ReturnType<typeof createStore>,
  items: OutlookItem[],
  syncToken: string | null,
  deltaLink = "https://graph.microsoft.com/v1.0/me/calendars/primary/calendarView/delta?$deltatoken=next",
): Promise<RunOutcome> => {
  answerWith(items, deltaLink);
  const fetcher = createOutlookSourceFetcher({
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

const STANDUP: OutlookItem = {
  end: { dateTime: "2026-06-20T09:30:00.0000000", timeZone: "UTC" },
  iCalUId: "standup@example.com",
  id: "outlook-standup",
  lastModifiedDateTime: "2026-06-01T00:00:00Z",
  start: { dateTime: "2026-06-20T09:00:00.0000000", timeZone: "UTC" },
  subject: "Standup",
  type: "singleInstance",
};

const DINNER: OutlookItem = {
  end: { dateTime: "2026-06-21T20:00:00.0000000", timeZone: "UTC" },
  iCalUId: "dinner@example.com",
  id: "outlook-dinner",
  lastModifiedDateTime: "2026-06-01T00:00:00Z",
  start: { dateTime: "2026-06-21T19:00:00.0000000", timeZone: "UTC" },
  subject: "Dinner",
  type: "singleInstance",
};

const DINNER_WITHOUT_ICAL_UID: OutlookItem = {
  end: DINNER.end,
  id: DINNER.id,
  lastModifiedDateTime: DINNER.lastModifiedDateTime,
  start: DINNER.start,
  subject: DINNER.subject,
  type: DINNER.type,
};

const seedFullSync = async (store: ReturnType<typeof createStore>): Promise<RunOutcome> => {
  const first = await ingestOutlook(store, [STANDUP, DINNER], null);
  expect(first.inserts.toSorted()).toEqual(["state-outlook-dinner", "state-outlook-standup"]);
  return first;
};

const deltaToken = (seeded: RunOutcome): string => {
  const { syncToken } = seeded;
  if (typeof syncToken !== "string") {
    throw new TypeError("The seeding full sync must persist a delta link");
  }
  return syncToken;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  deltaCallCount = 0;
});

describe("Outlook delta discards", () => {
  it("counts a changed event the provider stopped giving an iCalUId", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{ ...DINNER_WITHOUT_ICAL_UID, lastModifiedDateTime: "2026-06-10T00:00:00Z" }],
      deltaToken(seeded),
    );

    expect(run.deletes).toEqual(["state-outlook-dinner"]);
    expect(run.wideEvent["source_events.discarded_unrepresentable"]).toBe(1);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("counts a changed event whose start object carries a zone but no dateTime", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{ ...DINNER, start: { timeZone: "UTC" } }],
      deltaToken(seeded),
    );

    expect(run.deletes).toEqual(["state-outlook-dinner"]);
    expect(run.wideEvent["source_events.discarded_unrepresentable"]).toBe(1);
  });

  it("counts a changed event that moved outside the sync window", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{
        ...DINNER,
        end: { dateTime: "2026-03-01T20:00:00.0000000", timeZone: "UTC" },
        start: { dateTime: "2026-03-01T19:00:00.0000000", timeZone: "UTC" },
      }],
      deltaToken(seeded),
    );

    expect(run.deletes).toEqual(["state-outlook-dinner"]);
    expect(run.wideEvent["source_events.discarded_outside_window"]).toBe(1);
    expect(discardTotal(run.wideEvent)).toBe(1);
  });

  it("counts a changed event whose iCalUId became Keeper-authored", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{ ...DINNER, iCalUId: "abcdef01-2345-6789-abcd-ef0123456789@keeper.sh" }],
      deltaToken(seeded),
    );

    expect(run.deletes).toEqual(["state-outlook-dinner"]);
    expect(run.wideEvent["source_events.skipped_self_authored"]).toBe(1);
    expect(run.wideEvent["source_events.discarded_unrepresentable"]).toBe(0);
  });

  it("counts a changed event the provider tagged with the Keeper category", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{ ...DINNER, categories: ["keeper.sh"] }],
      deltaToken(seeded),
    );

    expect(run.deletes).toEqual(["state-outlook-dinner"]);
    expect(run.wideEvent["source_events.skipped_self_authored"]).toBe(1);
  });

  it("leaves every discard counter at zero on a delta that changed nothing", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(store, [], deltaToken(seeded));

    expect(run.deletes).toEqual([]);
    expect(run.inserts).toEqual([]);
    expect(discardTotal(run.wideEvent)).toBe(0);
    expect(store.ids()).toEqual(["state-outlook-dinner", "state-outlook-standup"]);
  });

  it("settles after a discard-driven deletion instead of churning", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);
    let token = deltaToken(seeded);
    const timeline: { deletes: number; inserts: number }[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const run = await ingestOutlook(
        store,
        [DINNER_WITHOUT_ICAL_UID],
        token,
      );
      timeline.push({ deletes: run.deletes.length, inserts: run.inserts.length });
      if (typeof run.syncToken === "string") {
        token = run.syncToken;
      }
    }

    expect(timeline).toEqual([
      { deletes: 1, inserts: 0 },
      { deletes: 0, inserts: 0 },
      { deletes: 0, inserts: 0 },
      { deletes: 0, inserts: 0 },
    ]);
    expect(store.ids()).toEqual(["state-outlook-standup"]);
  });

  // Graph answers `tzone://Microsoft/Custom` for a zone it cannot name.
  it("does not let one event with an uninterpretable response zone fail the calendar", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);
    const CUSTOM_ZONE_EVENT: OutlookItem = {
      ...DINNER,
      end: { dateTime: "2026-06-21T20:00:00.0000000", timeZone: "tzone://Microsoft/Custom" },
      start: { dateTime: "2026-06-21T19:00:00.0000000", timeZone: "tzone://Microsoft/Custom" },
    };

    const run = await ingestOutlook(
      store,
      [CUSTOM_ZONE_EVENT, { ...STANDUP, subject: "Standup (renamed)" }],
      deltaToken(seeded),
    );

    expect(run.wideEvent["outcome"]).not.toBe("error");
    expect(discardTotal(run.wideEvent)).toBeGreaterThan(0);
  });

  it("keeps ingesting the rest of the calendar past an uninterpretable response zone", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);
    const CUSTOM_ZONE_EVENT: OutlookItem = {
      ...DINNER,
      end: { dateTime: "2026-06-21T20:00:00.0000000", timeZone: "tzone://Microsoft/Custom" },
      start: { dateTime: "2026-06-21T19:00:00.0000000", timeZone: "tzone://Microsoft/Custom" },
    };
    let token = deltaToken(seeded);
    const outcomes: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const run = await ingestOutlook(
        store,
        [CUSTOM_ZONE_EVENT, { ...STANDUP, subject: "Standup (renamed)" }],
        token,
      ).catch((error: unknown) => {
        outcomes.push(describeThrow(error));
        return null;
      });
      if (!run) {
        continue;
      }
      outcomes.push(String(run.wideEvent["outcome"]));
      if (typeof run.syncToken === "string") {
        token = run.syncToken;
      }
    }

    expect(outcomes).toEqual(["success", "in-sync", "in-sync"]);
    expect(store.ids()).toEqual(["state-outlook-standup"]);
  });

  it("counts a changed event whose dateTime the provider malformed", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{ ...DINNER, start: { dateTime: "2026-06-21 19:00", timeZone: "UTC" } }],
      deltaToken(seeded),
    );

    expect(run.wideEvent["outcome"]).not.toBe("error");
    expect(discardTotal(run.wideEvent)).toBeGreaterThan(0);
  });

  it("counts an all-day event whose dateTime the provider malformed", async () => {
    const store = createStore();
    const seeded = await seedFullSync(store);

    const run = await ingestOutlook(
      store,
      [{
        ...DINNER,
        end: { dateTime: "not-a-date", timeZone: "UTC" },
        isCancelled: false,
        start: { dateTime: "not-a-date", timeZone: "UTC" },
      }],
      deltaToken(seeded),
    );

    expect(run.wideEvent["outcome"]).not.toBe("error");
    expect(discardTotal(run.wideEvent)).toBeGreaterThan(0);
  });
});
