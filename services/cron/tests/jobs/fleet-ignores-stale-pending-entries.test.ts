import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lockedCalendarIds: string[] = [];
const observedFields: [string, unknown][] = [];
const pendingScoreByCalendarId = new Map<string, number>();

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: (key: string, value: unknown) => {
      observedFields.push([key, value]);
    },
    setFields: (fields: Record<string, unknown>) => {
      for (const entry of Object.entries(fields)) {
        observedFields.push(entry);
      }
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

const buildOAuthSource = (calendarId: string): Record<string, unknown> => ({
  accountId: `account-${calendarId}`,
  accessToken: "access-token",
  calendarId,
  expiresAt: null,
  externalCalendarId: `external-${calendarId}`,
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: `credential-${calendarId}`,
  provider: "google",
  reauthenticationSource: null,
  refreshToken: "refresh-token",
  syncToken: null,
  userId: `user-${calendarId}`,
});

const OAUTH_SOURCES = [buildOAuthSource("wedged-drain"), buildOAuthSource("live-drain")];

/*
 * The inner re-read carries no calendarId column, so an empty row there ends the work as
 * skipped once the source lock is taken — the lock keys are what this suite observes.
 */
const resolveSourceRows = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return OAUTH_SOURCES;
  }
  return [];
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const rows = resolveSourceRows(projection);
  if (!("failureCount" in projection)) {
    return rows;
  }
  return rows.map((row) => ({ ...(row as Record<string, unknown>), failureCount: 0, nextAttemptAt: null }));
};

const createQuery = (resolve: () => unknown): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });

const fakeDatabase = {
  select: (projection: Record<string, unknown>) => createQuery(() => resolveSelect(projection)),
  transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
  update: () => createQuery(() => []),
};

const fakeRedis = {
  eval: () => Promise.resolve(null),
  get: () => Promise.resolve(null),
  zmscore: (_key: string, ...calendarIds: string[]) =>
    Promise.resolve(calendarIds.map((calendarId) => {
      const score = pendingScoreByCalendarId.get(calendarId) ?? null;
      if (score === null) {
        return null;
      }
      return String(score);
    })),
};

vi.mock("@/context", () => ({
  database: fakeDatabase,
  flushDatabase: fakeDatabase,
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: fakeRedis,
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: (key: string) => {
      lockedCalendarIds.push(key.replace("source-ingest:", ""));
      return Promise.resolve({
        acquired: true,
        handle: {
          isCurrent: () => Promise.resolve(true),
          isHeld: () => Promise.resolve(true),
          release: () => Promise.resolve(null),
        },
      });
    },
  }),
}));

const { ingestOAuthSources } = await import("../../src/jobs/ingest-sources");

const YIELDED_COUNT_FIELD = "ingest.yielded_count";
const DRAIN_TICK_MS = 10_000;
/* Far past any bound a 10s drain tick can justify: a receipt nobody has drained in an hour. */
const WEDGED_DRAIN_AGE_MS = 360 * DRAIN_TICK_MS;
const FRESH_RECEIPT_AGE_MS = 2 * DRAIN_TICK_MS;
const NOW_MS = 1_770_000_000_000;

const ingestedCalendarIds = (): string[] => lockedCalendarIds.toSorted();

const yieldedCounts = (): unknown[] =>
  observedFields.filter(([key]) => key === YIELDED_COUNT_FIELD).map(([, value]) => value);

describe("a stale pending entry does not keep the fleet away", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    observedFields.length = 0;
    pendingScoreByCalendarId.clear();
    vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ingests the calendar whose receipt the drain has not touched in far longer than its tick", async () => {
    pendingScoreByCalendarId.set("wedged-drain", NOW_MS - WEDGED_DRAIN_AGE_MS);
    pendingScoreByCalendarId.set("live-drain", NOW_MS - FRESH_RECEIPT_AGE_MS);

    await ingestOAuthSources();

    expect(ingestedCalendarIds()).toEqual(["wedged-drain"]);
  });

  it("counts only the fresh entry as yielded", async () => {
    pendingScoreByCalendarId.set("wedged-drain", NOW_MS - WEDGED_DRAIN_AGE_MS);
    pendingScoreByCalendarId.set("live-drain", NOW_MS - FRESH_RECEIPT_AGE_MS);

    await ingestOAuthSources();

    expect(yieldedCounts()).toEqual([1]);
  });

  it("keeps ingesting a wedged calendar on the pass after the entry goes stale", async () => {
    pendingScoreByCalendarId.set("wedged-drain", NOW_MS - FRESH_RECEIPT_AGE_MS);

    await ingestOAuthSources();
    expect(ingestedCalendarIds()).toEqual(["live-drain"]);

    lockedCalendarIds.length = 0;
    vi.setSystemTime(NOW_MS + WEDGED_DRAIN_AGE_MS);

    await ingestOAuthSources();

    expect(ingestedCalendarIds()).toEqual(["live-drain", "wedged-drain"]);
  });
});
