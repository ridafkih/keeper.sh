import { beforeEach, describe, expect, it, vi } from "vitest";

const lockedCalendarIds: string[] = [];
const observedFields: [string, unknown][] = [];
const pendingScoreByCalendarId = new Map<string, number>();
const batchScoreLookups: string[][] = [];

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

const OAUTH_SOURCES = [buildOAuthSource("calendar-a"), buildOAuthSource("calendar-b")];

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

/*
 * Only the batch score command is offered: a per-calendar score lookup would cost the fleet
 * one round trip per source, so an implementation that reaches for one has nothing to call.
 */
const fakeRedis = {
  eval: () => Promise.resolve(null),
  get: () => Promise.resolve(null),
  zmscore: (_key: string, ...calendarIds: string[]) => {
    batchScoreLookups.push(calendarIds);
    return Promise.resolve(calendarIds.map((calendarId) => {
      const score = pendingScoreByCalendarId.get(calendarId) ?? null;
      if (score === null) {
        return null;
      }
      return String(score);
    }));
  },
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

const ingestedCalendarIds = (): string[] => lockedCalendarIds.toSorted();

const yieldedCounts = (): unknown[] =>
  observedFields.filter(([key]) => key === YIELDED_COUNT_FIELD).map(([, value]) => value);

describe("the fleet yields a calendar a webhook already owns", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    observedFields.length = 0;
    batchScoreLookups.length = 0;
    pendingScoreByCalendarId.clear();
  });

  it("leaves a calendar with a fresh pending webhook entry out of the pass", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now() - 1000);

    await ingestOAuthSources();

    expect(ingestedCalendarIds()).toEqual(["calendar-b"]);
  });

  it("reports how many calendars it yielded on the pass wide event", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now() - 1000);

    await ingestOAuthSources();

    expect(yieldedCounts()).toEqual([1]);
  });

  it("ingests every calendar when the pending set is empty", async () => {
    await ingestOAuthSources();

    expect(ingestedCalendarIds()).toEqual(["calendar-a", "calendar-b"]);
    expect(yieldedCounts()).toEqual([0]);
  });

  it("looks the pending scores up once for the whole batch", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now() - 1000);

    await ingestOAuthSources();

    expect(batchScoreLookups).toEqual([["calendar-a", "calendar-b"]]);
  });

  it("never yields on the webhook path, which owns the calendars it names", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now() - 1000);

    await ingestOAuthSources(["calendar-a", "calendar-b"]);

    expect(ingestedCalendarIds()).toEqual(["calendar-a", "calendar-b"]);
  });
});
