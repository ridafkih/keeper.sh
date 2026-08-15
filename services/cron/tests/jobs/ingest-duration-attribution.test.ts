import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EmittedEvent {
  accounted_ms?: number;
  db?: { read_count?: number; write_count?: number };
  duration_ms?: number;
  ingest?: { lock_acquired?: boolean };
  operation?: { name?: string };
  outcome?: string;
  provider?: { calendar_id?: string };
  redis?: { command_ms_max?: number };
  token?: { refresh_attempted?: boolean };
  concurrency?: { slot_wait_ms?: number };
  wait?: {
    advisory_lock_ms?: number;
    db_pool_ms?: number;
    source_lock_ms?: number;
    token_refresh_ms?: number;
  };
  work?: { db_commit_ms?: number; db_read_ms?: number; db_write_ms?: number };
  error?: { error_message?: string; error_stack?: string };
}

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

const LOCK_WAIT_MS = 90;
const REDIS_COMMAND_MS = 40;
const POOL_WAIT_MS = 70;
const ADVISORY_WAIT_MS = 60;
const COMMIT_MS = 50;
const CALENDAR_ID = "calendar-primary";
// The third statement of the transaction is pg_advisory_xact_lock.
const ADVISORY_LOCK_STATEMENT_INDEX = 3;

const SECOND_POOL_WAIT_MS = 15;
let sourceCount = 1;
let stagedPoolWaits: number[] = [];
let lockAcquires = true;
let lockWaitMs = 0;
let redisCommandMs = 0;
let poolWaitMs = 0;
let advisoryWaitMs = 0;
let commitMs = 0;
let poolAcquisitionFails = false;

const baseSource = {
  accessToken: "access-token",
  accountId: "account-1",
  expiresAt: new Date(Date.now() + 3_600_000),
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: "credential-1",
  provider: "google",
  refreshToken: "refresh-token",
  syncToken: null,
  userId: "user-1",
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("encryptedPassword") || keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("sourceEventUid") && keys.has("recurrenceRule")) {
    return [];
  }
  if (keys.has("oauthCredentialId") && keys.has("reauthenticationSource")) {
    return Array.from({ length: sourceCount }, (_unused, index) => ({
      ...baseSource,
      calendarId: `${CALENDAR_ID}-${index}`,
      externalCalendarId: "primary",
      reauthenticationSource: null,
    }));
  }
  if (keys.has("oauthCredentialId")) {
    return [{
      ...baseSource,
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      reauthenticationSource: null,
    }];
  }
  throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
};

const createQuery = (resolve: () => unknown): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });
};

/*
 * The pool hands the callback over only after poolWaitMs, and the commit takes
 * commitMs after the callback returns — the two boundaries no in-callback timer
 * can see.
 */
const nextPoolWaitMs = (): number => {
  if (stagedPoolWaits.length === 0) {
    return poolWaitMs;
  }
  return stagedPoolWaits.shift() ?? poolWaitMs;
};

const runTransaction = async (work: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
  await Bun.sleep(nextPoolWaitMs());
  if (poolAcquisitionFails) {
    throw new Error("timeout exceeded when trying to connect");
  }
  let executeCount = 0;
  const transaction = {
    delete: () => createQuery(() => []),
    execute: async () => {
      executeCount += 1;
      if (executeCount === ADVISORY_LOCK_STATEMENT_INDEX) {
        await Bun.sleep(advisoryWaitMs);
      }
      return [];
    },
    insert: () => createQuery(() => []),
    select: (projection: Record<string, unknown>) => createQuery(() => resolveSelect(projection)),
    update: () => createQuery(() => []),
  };
  const result = await work(transaction);
  await Bun.sleep(commitMs);
  return result;
};

vi.mock("@/context", () => ({
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: runTransaction,
    update: () => createQuery(() => []),
  },
  refreshLockRedis: {
    eval: async (): Promise<unknown> => {
      await Bun.sleep(redisCommandMs);
      return "acquired";
    },
    get: async (): Promise<string | null> => {
      await Bun.sleep(redisCommandMs);
      return null;
    },
  },
  refreshLockStore: {},
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: (redis: { eval: () => Promise<unknown> }) => ({
    acquire: async () => {
      await Bun.sleep(lockWaitMs);
      await redis.eval();
      if (!lockAcquires) {
        return { acquired: false };
      }
      return {
        acquired: true,
        handle: {
          isCurrent: () => Promise.resolve(true),
          release: () => redis.eval().then(() => null),
        },
      };
    },
  }),
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createDatabase: () => Promise.resolve({}),
  decryptPassword: () => "plaintext",
}));

/*
 * The real engine is replaced by one that drives the persistence transaction and
 * nothing else, so the only segments in play are the ones this file asserts.
 */
vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    ingestSource: async (options: {
      withPersistenceTransaction: (
        work: (context: {
          flush: (changes: unknown) => Promise<void>;
          readExistingEvents: () => Promise<unknown[]>;
        }) => Promise<unknown>,
      ) => Promise<unknown>;
    }) => {
      await options.withPersistenceTransaction(async ({ flush, readExistingEvents }) => {
        await readExistingEvents();
        await flush({ deletes: [], inserts: [], syncToken: "next-token" });
        return null;
      });
      return { eventsAdded: 0, eventsRemoved: 0 };
    },
  };
});

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  sourceCount = 1;
  stagedPoolWaits = [];
  lockAcquires = true;
  lockWaitMs = 0;
  redisCommandMs = 0;
  poolWaitMs = 0;
  advisoryWaitMs = 0;
  commitMs = 0;
  poolAcquisitionFails = false;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as EmittedEvent);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const ingestEvents = async (): Promise<EmittedEvent[]> => {
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
  const events = emitted.filter((candidate) => candidate.operation?.name === "ingest-source");
  if (events.length === 0) {
    throw new Error("no ingest-source wide event was emitted");
  }
  return events;
};

const runTick = async (): Promise<EmittedEvent> => {
  const [event] = await ingestEvents();
  if (!event) {
    throw new Error("no ingest-source wide event was emitted");
  }
  return event;
};

describe("ingest duration decomposition", () => {
  it("charges a slow sync lock to wait.source_lock_ms, not to the residual", async () => {
    lockWaitMs = LOCK_WAIT_MS;

    const event = await runTick();

    expect(event.outcome).toBe("success");
    expect(event.ingest?.lock_acquired).toBe(true);
    expect(event.wait?.source_lock_ms).toBeGreaterThanOrEqual(LOCK_WAIT_MS);
    expect(event.duration_ms ?? 0).toBeGreaterThanOrEqual(event.wait?.source_lock_ms ?? 0);
  });

  it("separates a slow redis round trip from the lock wait it sits inside", async () => {
    redisCommandMs = REDIS_COMMAND_MS;

    const event = await runTick();

    expect(event.redis?.command_ms_max).toBeGreaterThanOrEqual(REDIS_COMMAND_MS);
    expect(event.wait?.source_lock_ms).toBeGreaterThanOrEqual(REDIS_COMMAND_MS);
  });

  it("attributes the pool handover, the advisory lock and the commit separately", async () => {
    poolWaitMs = POOL_WAIT_MS;
    advisoryWaitMs = ADVISORY_WAIT_MS;
    commitMs = COMMIT_MS;

    const event = await runTick();

    expect(event.wait?.db_pool_ms).toBeGreaterThanOrEqual(POOL_WAIT_MS);
    expect(event.wait?.advisory_lock_ms).toBeGreaterThanOrEqual(ADVISORY_WAIT_MS);
    expect(event.work?.db_commit_ms).toBeGreaterThanOrEqual(COMMIT_MS);
    expect(event.wait?.db_pool_ms).toBeLessThan(POOL_WAIT_MS + ADVISORY_WAIT_MS);
  });

  it("still charges the pool wait when the connection is never granted", async () => {
    poolWaitMs = POOL_WAIT_MS;
    poolAcquisitionFails = true;

    const event = await runTick();

    expect(event.outcome).toBe("error");
    expect(event.wait?.db_pool_ms ?? 0).toBeGreaterThanOrEqual(POOL_WAIT_MS);
  });

  it("counts the statements it timed on both sides of the transaction boundary", async () => {
    const event = await runTick();

    expect(event.db?.read_count ?? 0).toBeGreaterThanOrEqual(3);
    expect(event.db?.write_count ?? 0).toBeGreaterThanOrEqual(1);
    expect(event.work?.db_read_ms).toBeDefined();
    expect(event.work?.db_write_ms).toBeDefined();
  });

  it("keeps the slot wait outside duration_ms and outside the wait namespace", async () => {
    const event = await runTick();

    expect(event.concurrency?.slot_wait_ms).toBeDefined();
    expect(event.concurrency?.slot_wait_ms ?? -1).toBeGreaterThanOrEqual(0);
    expect(event.wait).not.toHaveProperty("slot_ms");
  });

  it("says the lock was lost rather than reporting a fast acquire", async () => {
    lockAcquires = false;
    lockWaitMs = LOCK_WAIT_MS;

    const event = await runTick();

    expect(event.ingest?.lock_acquired).toBe(false);
    expect(event.outcome).toBe("skipped");
    expect(event.wait?.source_lock_ms).toBeGreaterThanOrEqual(LOCK_WAIT_MS);
    expect(event.work?.db_commit_ms).toBeUndefined();
  });

  it("gives two concurrent ingests their own pool wait and neither the other's", async () => {
    sourceCount = 2;
    stagedPoolWaits = [POOL_WAIT_MS, SECOND_POOL_WAIT_MS];

    const events = await ingestEvents();
    const poolWaits = events
      .map((event) => event.wait?.db_pool_ms ?? -1)
      .toSorted((first, second) => first - second);

    expect(events).toHaveLength(2);
    expect(poolWaits[0]).toBeGreaterThanOrEqual(SECOND_POOL_WAIT_MS);
    expect(poolWaits[0]).toBeLessThan(POOL_WAIT_MS);
    expect(poolWaits[1]).toBeGreaterThanOrEqual(POOL_WAIT_MS);
    for (const event of events) {
      expect(event.accounted_ms ?? 0).toBeLessThanOrEqual(event.duration_ms ?? 0);
    }
  });

  it("never lets the accounted segments exceed the duration they decompose", async () => {
    lockWaitMs = LOCK_WAIT_MS;
    poolWaitMs = POOL_WAIT_MS;
    advisoryWaitMs = ADVISORY_WAIT_MS;
    commitMs = COMMIT_MS;

    const event = await runTick();
    const accounted = event.accounted_ms ?? 0;
    const duration = event.duration_ms ?? 0;

    expect(accounted).toBeGreaterThan(0);
    expect(accounted).toBeLessThanOrEqual(duration);
    expect(duration - accounted).toBeGreaterThanOrEqual(0);
  });
});
