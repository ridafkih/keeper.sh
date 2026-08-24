import { beforeEach, describe, expect, it, vi } from "vitest";

const lockedCalendarIds: string[] = [];
const observedFields: [string, unknown][] = [];
const pendingScoreByCalendarId = new Map<string, number>();
let markPendingAfterSnapshot: (() => void) | null = null;

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
    const reply = calendarIds.map((calendarId) => readScore(calendarId));
    markPendingAfterSnapshot?.();
    markPendingAfterSnapshot = null;
    return Promise.resolve(reply);
  },
  zscore: (_key: string, calendarId: string) => Promise.resolve(readScore(calendarId)),
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

describe("the fleet yield check races a webhook that lands during the pass", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    observedFields.length = 0;
    pendingScoreByCalendarId.clear();
    markPendingAfterSnapshot = null;
  });

  it("leaves a calendar alone once its webhook receipt is in the pending set, even when the receipt lands just after the pass snapshot", async () => {
    markPendingAfterSnapshot = () => {
      pendingScoreByCalendarId.set("calendar-b", Date.now());
    };

    await ingestOAuthSources();

    expect(lockedCalendarIds.toSorted()).toEqual(["calendar-a"]);
  });
});
