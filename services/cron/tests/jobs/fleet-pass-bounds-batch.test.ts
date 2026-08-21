import { beforeEach, describe, expect, it, vi } from "vitest";

const lockedCalendarIds: string[] = [];
const observedFields: [string, unknown][] = [];

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

const FLEET_SOURCE_COUNT = 400;

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

const FLEET_CALENDAR_IDS = Array.from(
  { length: FLEET_SOURCE_COUNT },
  (_unused, index) => `calendar-${String(index).padStart(4, "0")}`,
);

const OAUTH_SOURCES = FLEET_CALENDAR_IDS.map((calendarId) => buildOAuthSource(calendarId));

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
  return rows.map((row) => ({
    ...(row as Record<string, unknown>),
    failureCount: 0,
    nextAttemptAt: null,
  }));
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
    Promise.resolve(calendarIds.map(() => null)),
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
      lockedCalendarIds.push(key.replaceAll("source-ingest:", ""));
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

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");

const { FLEET_PASS_SOURCE_BOUND, ingestOAuthSources } = ingestSourcesModule as typeof ingestSourcesModule & {
  FLEET_PASS_SOURCE_BOUND?: number;
};

const TAKEN_COUNT_FIELD = "ingest.taken_count";
const DEFERRED_COUNT_FIELD = "ingest.deferred_count";

const fieldValues = (field: string): unknown[] =>
  observedFields.filter(([key]) => key === field).map(([, value]) => value);

describe("a fleet pass bounds the work it takes on", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    observedFields.length = 0;
  });

  it("exports a bound smaller than the fleet it is protecting against", () => {
    expect(typeof FLEET_PASS_SOURCE_BOUND).toBe("number");
    expect(FLEET_PASS_SOURCE_BOUND).toBeGreaterThan(0);
    expect(FLEET_PASS_SOURCE_BOUND).toBeLessThan(FLEET_SOURCE_COUNT);
  });

  it("ingests at most the bound, not every source in the fleet", async () => {
    await ingestOAuthSources();

    expect(lockedCalendarIds.length).toBeLessThan(FLEET_SOURCE_COUNT);
    expect(lockedCalendarIds.length).toBe(FLEET_PASS_SOURCE_BOUND);
  });

  it("reports what it took and what it deferred on the pass wide event", async () => {
    await ingestOAuthSources();

    expect(fieldValues(TAKEN_COUNT_FIELD)).toEqual([lockedCalendarIds.length]);
    expect(fieldValues(DEFERRED_COUNT_FIELD)).toEqual([
      FLEET_SOURCE_COUNT - lockedCalendarIds.length,
    ]);
  });

  it("leaves the webhook path unbounded, since it owns the calendars it names", async () => {
    await ingestOAuthSources(FLEET_CALENDAR_IDS);

    expect(lockedCalendarIds).toHaveLength(FLEET_SOURCE_COUNT);
    expect(fieldValues(DEFERRED_COUNT_FIELD)).toEqual([]);
  });
});
