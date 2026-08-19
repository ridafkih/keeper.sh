import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Pins the outcome of a source whose ingest SUCCEEDS (flush committed, work()
 * returned) but whose post-work isCurrent() probe rejects — a renewal-tick
 * blip latched into SyncLockRenewalError, or a raw redis.eval failure. The
 * probe only gates the optional resetIngestBackoff write; its rejection
 * carries no information about the committed ingest, so it must not replace
 * the successful result with a failure, and it must never feed the provider
 * backoff escalator.
 */
const harness = vi.hoisted(() => {
  const state = {
    backoffWriteCount: 0,
    fetchCallCount: 0,
    ingestCallCount: 0,
    isCurrentCallCount: 0,
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
      /*
       * A prior pass failed once, so the success path wants to clear the
       * backoff row — which routes it through the isCurrent() probe.
       */
      return [{ failureCount: 1, nextAttemptAt: null }];
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
        if ("ingestFailureCount" in values && values.ingestFailureCount !== 0) {
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

  const createOutlookAccountSemaphore = vi.fn(() => ({
    acquireLease: () => Promise.resolve({ key: "lease-key", token: "lease-token" }),
    release: (): Promise<void> => Promise.resolve(),
  }));

  const createOutlookSourceFetcher = () => ({
    fetchEvents: (): Promise<unknown> => {
      state.fetchCallCount += 1;
      return Promise.resolve({ events: [] });
    },
  });

  const ingestSource = vi.fn((): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    state.ingestCallCount += 1;
    return Promise.resolve({ eventsAdded: 3, eventsRemoved: 1 });
  });

  /*
   * The lock acquires and releases normally, but every isCurrent probe hits a
   * Redis failure — the renewal-error latch and the eval-backed probe both
   * surface exactly this way after a transient blip. The mocked ingestSource
   * never consults isCurrent mid-run, so the ONLY caller is the success path's
   * own post-commit probe at ingest-sources.ts line 232.
   */
  const isCurrent = (): Promise<boolean> => {
    state.isCurrentCallCount += 1;
    return Promise.reject(new Error("redis eval timed out during isCurrent"));
  };

  return {
    createOutlookAccountSemaphore,
    createOutlookSourceFetcher,
    database,
    flushDatabase,
    ingestSource,
    isCurrent,
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
        isCurrent: harness.isCurrent,
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

describe("isCurrent rejection after a successful ingest with a prior failure", () => {
  it("keeps the successful result and applies no backoff", async () => {
    const result = await ingestOAuthSources();

    /* The ingest itself ran to completion and the probe was actually hit. */
    expect(harness.state.fetchCallCount).toBe(1);
    expect(harness.state.ingestCallCount).toBe(1);
    expect(harness.state.isCurrentCallCount).toBeGreaterThan(0);

    /*
     * The rejected probe must not clobber the committed ingest: the source
     * counts as a success with its events, and no backoff row is escalated.
     */
    expect(result.errors).toBe(0);
    expect(result.added).toBe(3);
    expect(result.removed).toBe(1);
    expect(result.affectedUserIds).toEqual(["user-1"]);
    expect(harness.state.backoffWriteCount).toBe(0);
  });
});
