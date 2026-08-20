import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Only the push lane may supersede, so the fleet must keep queueing as "background" —
 * preempting fleet passes would let the sweep discard its own paid-for provider reads
 * fleet-wide. And when a preempting waiter does take the lock away mid-pass, the losing
 * fleet ingest flushed nothing: counting it as a pass over that calendar would close the
 * coverage gap in the bookkeeping without closing it in the data.
 */
const harness = vi.hoisted(() => {
  interface LockAcquisition {
    acquisition: string;
    key: string;
  }

  const state = {
    backoffWrites: 0,
    ingestCalls: 0,
    isCurrentDuringIngest: true,
    lockAcquisitions: [] as LockAcquisition[],
    outcomes: [] as unknown[],
  };

  const FUTURE_EXPIRY_MS = 3_600_000;

  /* A null ingestWindowRecordedAt is what makes a completed pass count as the first ingest. */
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
          state.backoffWrites += 1;
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

  /*
   * Mirrors packages/calendar/src/core/sync-engine/ingest.ts: the engine probes currency
   * before persisting and returns the SAME empty result whether it was superseded or the
   * source genuinely had nothing new. The return value therefore cannot distinguish the
   * two — the caller holding the lock handle is the only one that can.
   */
  const ingestSource = async (options: {
    fetchEvents: () => Promise<unknown>;
    isCurrent?: () => Promise<boolean>;
  }): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    state.ingestCalls += 1;
    await options.fetchEvents();
    await options.isCurrent?.();
    return { eventsAdded: 0, eventsRemoved: 0 };
  };

  const isCurrent = (): Promise<boolean> => Promise.resolve(state.isCurrentDuringIngest);

  const createSyncLock = (_redis: unknown, acquisition = "preempting") => ({
    acquire: (key: string, ...rest: unknown[]) => {
      const perAcquire = rest.find(
        (argument): argument is string =>
          argument === "background" || argument === "preempting",
      );
      state.lockAcquisitions.push({ acquisition: perAcquire ?? acquisition, key });
      return Promise.resolve({
        acquired: true,
        handle: {
          isCurrent,
          isHeld: () => Promise.resolve(true),
          release: () => Promise.resolve(),
        },
      });
    },
  });

  return {
    createOutlookAccountSemaphore,
    createSyncLock,
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
    ingestSource: harness.ingestSource,
  };
});

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSourceFetcher: () => ({
    fetchEvents: (): Promise<unknown> => Promise.resolve({ events: [] }),
  }),
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createSyncLock: harness.createSyncLock };
});

/* No client secrets, so the token-refresh branch is skipped entirely. */
vi.mock("../../src/env", () => ({ default: {} }));
vi.mock("../../src/context", () => ({
  database: harness.database,
  flushDatabase: harness.flushDatabase,
  flushDrainRegistry: { register: (): null => null },
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    call: () => Promise.resolve("OK"),
    del: () => Promise.resolve(1),
    eval: () => Promise.resolve([0, 0]),
    get: () => Promise.resolve(null),
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
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
    set: (key: string, value: unknown) => {
      if (key === "outcome") {
        harness.state.outcomes.push(value);
      }
      return null;
    },
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
  firstIngestUserIds: string[];
  removed: number;
}

type IngestOAuthSources = (calendarIds?: string[]) => Promise<IngestionBatchResult>;

let ingestOAuthSources: IngestOAuthSources = () => {
  throw new Error("Module not loaded");
};

const SOURCE_LOCK_KEY = "source-ingest:calendar-1";

const sourceLockAcquisitions = (): string[] =>
  harness.state.lockAcquisitions
    .filter(({ key }) => key === SOURCE_LOCK_KEY)
    .map(({ acquisition }) => acquisition);

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources") as unknown as Record<
    string,
    unknown
  >;
  expect(typeof module.ingestOAuthSources).toBe("function");
  ingestOAuthSources = module.ingestOAuthSources as IngestOAuthSources;
});

beforeEach(() => {
  harness.state.backoffWrites = 0;
  harness.state.ingestCalls = 0;
  harness.state.isCurrentDuringIngest = true;
  harness.state.lockAcquisitions.length = 0;
  harness.state.outcomes.length = 0;
});

describe("a fleet ingest that loses its lock to a preempting waiter", () => {
  it("still takes the source lock as a background waiter", async () => {
    await ingestOAuthSources();

    expect(sourceLockAcquisitions()).toEqual(["background"]);
  });

  it("records no successful pass over the calendar and accrues no backoff", async () => {
    harness.state.isCurrentDuringIngest = false;

    const result = await ingestOAuthSources();

    expect(harness.state.ingestCalls).toBe(1);
    /* Supersession is not a provider failure, so it must not feed the backoff escalator. */
    expect(result.errors).toBe(0);
    expect(harness.state.backoffWrites).toBe(0);
    /* Nothing was flushed, so the calendar has had no first ingest and nothing to push. */
    expect(result.affectedUserIds).toEqual([]);
    expect(result.firstIngestUserIds).toEqual([]);
    expect(harness.state.outcomes).not.toContain("success");
  });

  /*
   * Guards the fix against conflating the two: an empty ingest that kept the lock is a
   * completed pass, and collapsing it into the superseded path would strand a quiet
   * calendar on ingestWindowRecordedAt null forever.
   */
  it("still records a pass when a current ingest simply found nothing", async () => {
    const result = await ingestOAuthSources();

    expect(harness.state.ingestCalls).toBe(1);
    expect(result.firstIngestUserIds).toEqual(["user-1"]);
    expect(result.affectedUserIds).toEqual(["user-1"]);
    expect(harness.state.outcomes).toContain("success");
  });
});
