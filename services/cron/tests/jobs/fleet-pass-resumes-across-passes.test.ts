import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ingestOAuthSources } from "../../src/jobs/ingest-sources";

const lockedCalendarIds: string[] = [];
const sharedRedisStore = new Map<string, string>();

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

const buildCalendarId = (index: number): string => `calendar-${String(index).padStart(4, "0")}`;

const FLEET_CALENDAR_IDS = Array.from({ length: FLEET_SOURCE_COUNT }, (_unused, index) =>
  buildCalendarId(index),
);

const OAUTH_SOURCES = FLEET_CALENDAR_IDS.map((calendarId) => buildOAuthSource(calendarId));

const resolveSourceRows = (projection: Record<string, unknown>): Record<string, unknown>[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return OAUTH_SOURCES;
  }
  return [];
};

const resolveSelect = (projection: Record<string, unknown>): Record<string, unknown>[] => {
  const rows = resolveSourceRows(projection);
  if (!("failureCount" in projection)) {
    return rows;
  }
  return rows.map((row) => ({
    ...row,
    failureCount: 0,
    nextAttemptAt: null,
  }));
};

interface QueryBounds {
  limit: number | null;
  offset: number;
}

const applyBounds = (rows: Record<string, unknown>[], bounds: QueryBounds): Record<string, unknown>[] => {
  const { limit, offset } = bounds;
  if (limit === null) {
    return rows.slice(offset);
  }
  return rows.slice(offset, offset + limit);
};

const createQuery = (resolve: () => Record<string, unknown>[], bounds: QueryBounds): unknown =>
  new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => applyBounds(resolve(), bounds))
            .then(onFulfilled)
            .catch(onRejected);
      }
      return (...args: unknown[]) => {
        if (property === "limit") {
          bounds.limit = Number(args[0]);
        }
        if (property === "offset") {
          bounds.offset = Number(args[0]);
        }
        return createQuery(resolve, bounds);
      };
    },
  });

const fakeDatabase = {
  select: (projection: Record<string, unknown>) =>
    createQuery(() => resolveSelect(projection), { limit: null, offset: 0 }),
  transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
  update: () => createQuery(() => [], { limit: null, offset: 0 }),
};

const readStoredNumber = (key: string): number => {
  const stored = sharedRedisStore.get(key);
  if (!stored) {
    return 0;
  }
  return Number(stored);
};

const fakeRedis = {
  call: (command: string, ...args: string[]): Promise<string | null> => {
    const [key, value] = args;
    if (command === "set" && key) {
      sharedRedisStore.set(key, value ?? "");
      return Promise.resolve("OK");
    }
    if (command === "get" && key) {
      return Promise.resolve(sharedRedisStore.get(key) ?? null);
    }
    return Promise.resolve(null);
  },
  del: (...keys: string[]): Promise<number> => {
    for (const key of keys) {
      sharedRedisStore.delete(key);
    }
    return Promise.resolve(keys.length);
  },
  eval: (): Promise<null> => Promise.resolve(null),
  get: (key: string): Promise<string | null> =>
    Promise.resolve(sharedRedisStore.get(key) ?? null),
  getset: (key: string, value: string): Promise<string | null> => {
    const previous = sharedRedisStore.get(key) ?? null;
    sharedRedisStore.set(key, value);
    return Promise.resolve(previous);
  },
  incr: (key: string): Promise<number> => {
    const next = readStoredNumber(key) + 1;
    sharedRedisStore.set(key, String(next));
    return Promise.resolve(next);
  },
  incrby: (key: string, amount: string | number): Promise<number> => {
    const next = readStoredNumber(key) + Number(amount);
    sharedRedisStore.set(key, String(next));
    return Promise.resolve(next);
  },
  set: (key: string, value: string): Promise<string> => {
    sharedRedisStore.set(key, value);
    return Promise.resolve("OK");
  },
  zmscore: (_key: string, ...calendarIds: string[]): Promise<(string | null)[]> =>
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

interface IngestSourcesModule {
  ingestOAuthSources: typeof ingestOAuthSources;
}

const startProcess = (): Promise<IngestSourcesModule> => {
  vi.resetModules();
  return import("../../src/jobs/ingest-sources");
};

const runPass = async (job: IngestSourcesModule): Promise<string[]> => {
  lockedCalendarIds.length = 0;
  await job.ingestOAuthSources();
  return [...lockedCalendarIds];
};

const MAX_PASSES = 8;
const LAST_CALENDAR_ID = buildCalendarId(FLEET_SOURCE_COUNT - 1);

describe("every calendar is reached within a bounded number of passes", () => {
  beforeEach(() => {
    lockedCalendarIds.length = 0;
    sharedRedisStore.clear();
  });

  it("covers the whole fleet across consecutive passes of one process", async () => {
    const job = await startProcess();
    const visitedCalendarIds = new Set<string>();

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const ingestedCalendarIds = await runPass(job);
      expect(ingestedCalendarIds.length).toBeLessThan(FLEET_SOURCE_COUNT);
      for (const calendarId of ingestedCalendarIds) {
        visitedCalendarIds.add(calendarId);
      }
    }

    expect(visitedCalendarIds.has(LAST_CALENDAR_ID)).toBe(true);
    expect(visitedCalendarIds.size).toBe(FLEET_SOURCE_COUNT);
  });

  it("resumes past the previous pass after a restart instead of retaking the head", async () => {
    const firstPassCalendarIds = await runPass(await startProcess());
    const restartedPassCalendarIds = await runPass(await startProcess());

    expect(firstPassCalendarIds.length).toBeGreaterThan(0);
    expect(restartedPassCalendarIds[0]).not.toBe(firstPassCalendarIds[0]);
    expect(
      new Set([...firstPassCalendarIds, ...restartedPassCalendarIds]).size,
    ).toBeGreaterThan(firstPassCalendarIds.length);
  });

  it("covers the whole fleet even when every pass runs in a fresh process", async () => {
    const visitedCalendarIds = new Set<string>();

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const ingestedCalendarIds = await runPass(await startProcess());
      for (const calendarId of ingestedCalendarIds) {
        visitedCalendarIds.add(calendarId);
      }
    }

    expect(visitedCalendarIds.has(LAST_CALENDAR_ID)).toBe(true);
    expect(visitedCalendarIds.size).toBe(FLEET_SOURCE_COUNT);
  });
});
