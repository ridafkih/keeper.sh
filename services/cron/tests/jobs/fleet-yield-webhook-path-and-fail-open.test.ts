import { beforeEach, describe, expect, it, vi } from "vitest";

const lockedCalendarIds: string[] = [];
const errorSlugs: string[] = [];
const pendingScoreByCalendarId = new Map<string, number>();
const pendingLookups: string[] = [];
let pendingLookupFails = false;

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      const { slug } = fields;
      errorSlugs.push(String(slug));
    },
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
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

const readScore = (calendarId: string): string | null => {
  const score = pendingScoreByCalendarId.get(calendarId) ?? null;
  if (score === null) {
    return null;
  }
  return String(score);
};

const fakeRedis = {
  eval: () => Promise.resolve(null),
  get: () => Promise.resolve(null),
  zmscore: (_key: string, ...calendarIds: string[]) => {
    pendingLookups.push(`zmscore:${calendarIds.join(",")}`);
    if (pendingLookupFails) {
      return Promise.reject(new Error("redis unavailable"));
    }
    return Promise.resolve(calendarIds.map((calendarId) => readScore(calendarId)));
  },
  zscore: (_key: string, calendarId: string) => {
    pendingLookups.push(`zscore:${calendarId}`);
    if (pendingLookupFails) {
      return Promise.reject(new Error("redis unavailable"));
    }
    return Promise.resolve(readScore(calendarId));
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

const { ingestOAuthSources } = await import("../../src/jobs/ingest-sources");

const YIELD_LOOKUP_FAILURE_SLUG = "pending-ingest-yield-lookup-failed";

describe("the webhook path and the fail-open behaviour are untouched", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    errorSlugs.length = 0;
    pendingLookups.length = 0;
    pendingScoreByCalendarId.clear();
    pendingLookupFails = false;
  });

  it("ingests every calendar it was handed even while both sit fresh in the pending set", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now());
    pendingScoreByCalendarId.set("calendar-b", Date.now());

    await ingestOAuthSources(["calendar-a", "calendar-b"]);

    expect(lockedCalendarIds.toSorted()).toEqual(["calendar-a", "calendar-b"]);
  });

  it("spends no redis round trip on the pending set when it was handed calendars", async () => {
    pendingScoreByCalendarId.set("calendar-a", Date.now());

    await ingestOAuthSources(["calendar-a", "calendar-b"]);

    expect(pendingLookups).toEqual([]);
  });

  it("ingests a calendar whose pending lookup fails rather than skipping it", async () => {
    pendingLookupFails = true;

    await ingestOAuthSources();

    expect(lockedCalendarIds.toSorted()).toEqual(["calendar-a", "calendar-b"]);
  });

  it("logs the existing slug when the pending lookup fails", async () => {
    pendingLookupFails = true;

    await ingestOAuthSources();

    expect(errorSlugs).toContain(YIELD_LOOKUP_FAILURE_SLUG);
  });
});
