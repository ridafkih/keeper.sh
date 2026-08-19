import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Pins the outcome of a source whose ingest SUCCEEDS but whose rate-limiter
 * dispose() rejects in the finally (outlook lease release hitting a Redis
 * error). The lease TTL already guarantees slot recovery, so a failed release
 * must not replace the successful result with a failure: the settlement should
 * stay fulfilled, count its events, and never feed the ingest backoff.
 */
const harness = vi.hoisted(() => {
  const state = {
    backoffWriteCount: 0,
    disposeCallCount: 0,
    fetchCallCount: 0,
    ingestCallCount: 0,
    releaseCallCount: 0,
  };

  const FUTURE_EXPIRY_MS = 3_600_000;

  const sourceRow = {
    accountId: "account-1",
    accessToken: "access-token",
    calendarId: "calendar-1",
    expiresAt: new Date(Date.now() + FUTURE_EXPIRY_MS),
    externalCalendarId: "external-calendar-1",
    ingestFutureRange: "6m",
    ingestHistoricRange: "1m",
    ingestWindowEnd: null,
    ingestWindowRecordedAt: null,
    ingestWindowStart: null,
    oauthCredentialId: "credential-1",
    provider: "outlook",
    reauthenticationSource: null,
    refreshToken: "refresh-token",
    syncToken: null,
    userId: "user-1",
  };

  const resolveLimited = (fields: Record<string, unknown>): unknown[] => {
    if ("failureCount" in fields) {
      return [{ failureCount: 0, nextAttemptAt: null }];
    }
    if ("accessToken" in fields) {
      return [sourceRow];
    }
    return [];
  };

  const resolveListing = (fields: Record<string, unknown>): unknown[] => {
    if ("reauthenticationSource" in fields) {
      return [sourceRow];
    }
    return [];
  };

  const createQueryBuilder = (fields: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.from = chain;
    builder.innerJoin = chain;
    builder.leftJoin = chain;
    /*
     * Bare awaits are the stored-event count and the destination-mapping read;
     * zero rows mean weight from defaults and default required ranges.
     */
    const resolveBare = (): unknown[] => {
      if ("count" in fields) {
        return [{ count: 0 }];
      }
      return [];
    };
    builder.where = () =>
      Object.assign(Promise.resolve(resolveBare()), {
        limit: () => Promise.resolve(resolveLimited(fields)),
        orderBy: () => Promise.resolve(resolveListing(fields)),
      });
    return builder;
  };

  const updateBuilder = {
    set: (values: Record<string, unknown>) => ({
      where: () => {
        if ("ingestFailureCount" in values) {
          state.backoffWriteCount += 1;
        }
        return Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([]),
        });
      },
    }),
  };

  const database = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    update: () => updateBuilder,
  };

  const flushDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({ execute: () => Promise.resolve([]) }),
    update: () => updateBuilder,
  };

  /*
   * The semaphore's lease is granted normally, but the explicit release hits a
   * Redis failure. The TTL still reclaims the slot, so this rejection carries
   * no information the run needs to act on.
   */
  const createOutlookAccountSemaphore = vi.fn(() => ({
    acquireLease: () => Promise.resolve({ key: "lease-key", token: "lease-token" }),
    release: (): Promise<void> => {
      state.releaseCallCount += 1;
      return Promise.reject(new Error("redis connection reset during lease release"));
    },
  }));

  const createOutlookSourceFetcher = (
    params: { rateLimiter?: { acquire: (count: number) => Promise<void> } },
  ) => ({
    fetchEvents: async (): Promise<unknown> => {
      state.fetchCallCount += 1;
      /* Pagination goes through the limiter, so the lease is genuinely held. */
      await params.rateLimiter?.acquire(1);
      return { events: [] };
    },
  });

  const ingestSource = vi.fn((): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    state.ingestCallCount += 1;
    return Promise.resolve({ eventsAdded: 3, eventsRemoved: 1 });
  });

  return {
    createOutlookAccountSemaphore,
    createOutlookSourceFetcher,
    database,
    flushDatabase,
    ingestSource,
    state,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createOutlookAccountSemaphore: harness.createOutlookAccountSemaphore,
    ingestSource: async (options: { fetchEvents: () => Promise<unknown> }) => {
      await options.fetchEvents();
      return await harness.ingestSource();
    },
  };
});

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSourceFetcher: harness.createOutlookSourceFetcher,
}));

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

/* No client secrets, so the token-refresh branch is skipped entirely. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  database: harness.database,
  flushDatabase: harness.flushDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    call: () => Promise.resolve("OK"),
    del: () => Promise.resolve(1),
    eval: () => Promise.resolve([0, 0]),
    get: () => Promise.resolve(null),
  },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
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
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

interface IngestionBatchResult {
  added: number;
  affectedUserIds: string[];
  errors: number;
  removed: number;
}

type IngestOAuthSources = (calendarIds?: string[]) => Promise<IngestionBatchResult>;

let ingestOAuthSources: IngestOAuthSources = () => {
  throw new Error("Module not loaded");
};

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources") as unknown as Record<string, unknown>;
  expect(typeof module.ingestOAuthSources).toBe("function");
  ingestOAuthSources = module.ingestOAuthSources as IngestOAuthSources;
});

describe("rate limiter dispose rejection after a successful ingest", () => {
  it("keeps the successful result and applies no backoff", async () => {
    const result = await ingestOAuthSources();

    /* The ingest itself ran to completion and the lease release was attempted. */
    expect(harness.state.fetchCallCount).toBe(1);
    expect(harness.state.ingestCallCount).toBe(1);
    expect(harness.state.releaseCallCount).toBe(1);

    /*
     * The rejected dispose must not clobber the fulfilled ingest: the source
     * counts as a success with its events, not as an error feeding backoff.
     */
    expect(result.errors).toBe(0);
    expect(result.added).toBe(3);
    expect(result.removed).toBe(1);
    expect(result.affectedUserIds).toEqual(["user-1"]);
    expect(harness.state.backoffWriteCount).toBe(0);
  });
});
