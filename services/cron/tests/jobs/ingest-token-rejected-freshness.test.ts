import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

interface FetchOutcome {
  events: unknown[];
  fullSyncRequired?: boolean;
  nextSyncToken?: string;
}

const emitted: WideEvent[] = [];
const updates: Record<string, unknown>[] = [];
let current: WideEvent = { fields: {}, values: {} };
let fetchOutcome: () => FetchOutcome = () => ({ events: [] });

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
    },
    time: {
      measure: <TResult>(_key: string, run: () => Promise<TResult>) => run(),
    },
  },
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    ENCRYPTION_KEY: "0".repeat(64),
    WORKER_JOB_QUEUE_ENABLED: false,
  },
}));

vi.mock("@/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(null),
}));

const CALDAV_SOURCE = {
  accountId: "account-1",
  calendarId: "calendar-1",
  calendarUrl: "https://dav.example.com/cal/",
  encryptedPassword: "cipher",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowRecordedAt: null,
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  userId: "user-1",
  username: "dav-user",
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  if (keys.has("encryptedPassword")) {
    return [CALDAV_SOURCE];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  if (keys.has("sourceEventUid")) {
    return [];
  }
  throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
};

const createQuery = (resolve: () => unknown): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (
          onFulfilled: (value: unknown) => unknown,
          onRejected: (reason: unknown) => unknown,
        ) => Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });
};

const createUpdateQuery = (sink: Record<string, unknown>[]): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve().then(() => []).then(onFulfilled);
      }
      if (property === "set") {
        return (values: Record<string, unknown>) => {
          sink.push(values);
          return createUpdateQuery(sink);
        };
      }
      return () => createUpdateQuery(sink);
    },
  });
};

const transactionWrites: Record<string, unknown>[] = [];

const transactionHandle = {
  delete: () => createUpdateQuery(transactionWrites),
  execute: () => Promise.resolve([]),
  insert: () => createUpdateQuery(transactionWrites),
  select: (projection: Record<string, unknown>) =>
    createQuery(() => resolveSelect(projection)),
  update: () => createUpdateQuery(transactionWrites),
};

vi.mock("@/context", () => ({
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work(transactionHandle),
    update: () => createUpdateQuery(updates),
  },
  refreshLockRedis: {},
  refreshLockStore: {},
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(null),
      },
    }),
  }),
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createDatabase: () => Promise.resolve({}),
  decryptPassword: () => "plaintext",
}));

vi.mock("@keeper.sh/calendar/caldav", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createCalDAVSourceFetcher: () => ({
    fetchEvents: () => Promise.resolve().then(fetchOutcome),
  }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = async (outcome: () => FetchOutcome): Promise<void> => {
  fetchOutcome = outcome;
  emitted.length = 0;
  updates.length = 0;
  transactionWrites.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const recordedFreshness = (): Record<string, unknown>[] =>
  updates.filter((values) => "ingestLastSucceededAt" in values);

/*
 * Two-way sync writes to and deletes from a real source calendar on the strength of the
 * stored copy, and only while that copy is younger than the freshness bound. A tick whose
 * sync token the provider rejected read nothing at all: it cleared the token and returned.
 * Stamping it as a confirmation would un-pause write-back against a copy that is exactly
 * as old as it was before the tick ran.
 */
describe("a tick whose sync token the provider rejected", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    transactionWrites.length = 0;
    current = { fields: {}, values: {} };
  });

  it("does not record the stored copy as confirmed", async () => {
    await runTick(() => ({ events: [], fullSyncRequired: true }));

    expect(emitted.some((event) => event.values["ingest.outcome"] === "full-sync-required"))
      .toBe(true);
    expect(recordedFreshness().length).toBe(0);
  });

  it("still records the stored copy as confirmed on a clean read", async () => {
    await runTick(() => ({ events: [], nextSyncToken: "token-2" }));

    expect(recordedFreshness().length).toBe(1);
    expect(recordedFreshness()[0]?.ingestLastSucceededAt).toBeInstanceOf(Date);
  });
});
