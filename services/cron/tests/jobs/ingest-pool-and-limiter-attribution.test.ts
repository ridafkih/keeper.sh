import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EmittedEvent {
  database?: {
    pool?: { in_flight?: number };
    queries?: { queued_count?: number };
  };
  operation?: { name?: string };
  outcome?: string;
  provider?: { calendar_id?: string };
  wait?: { rate_limiter_key?: string; rate_limiter_ms?: number };
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

const CALENDAR_ID = "calendar-primary";

/* The fleet lane holds four pool permits, so a wider fan-out is what forces a query to queue. */
const CONTENDING_SOURCE_COUNT = 12;
const CONTENDED_READ_MS = 40;

/*
 * The limiter floors every retry poll at 100ms, so a shorter injected wait would assert
 * the poll interval rather than the wait it is meant to attribute.
 */
const LIMITER_WAIT_MS = 150;
const LIMITER_WINDOW_OCCUPANCY = 500;

/* Bun.sleep can return a fraction of a millisecond early. */
const TIMER_SLACK_MS = 5;

const RATE_LIMITER_SCRIPT_MARKER = "ZREMRANGEBYSCORE";

let sourceCount = 1;
let gatedReadMs = 0;
let limiterWaitCount = 0;
const limiterWaitsServed = new Map<string, number>();

const STORED_INGEST_SEQ = 0;

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
  ingestSeq: STORED_INGEST_SEQ,
  refreshToken: "refresh-token",
  syncToken: null,
  userId: "user-1",
};

const buildSourceRows = (): unknown[] => {
  if (sourceCount === 1) {
    return [{
      ...baseSource,
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      reauthenticationSource: null,
    }];
  }
  /* Distinct users so the groups fan out: one user's calendars run two at a time. */
  return Array.from({ length: sourceCount }, (_unused, index) => ({
    ...baseSource,
    calendarId: `${CALENDAR_ID}-${index}`,
    externalCalendarId: "primary",
    reauthenticationSource: null,
    userId: `user-${index}`,
  }));
};

const resolveSourceRows = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.size === 1 && keys.has("ingestSeq")) {
    return [{ ingestSeq: STORED_INGEST_SEQ }];
  }
  if (keys.has("encryptedPassword") || keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("sourceEventUid") && keys.has("recurrenceRule")) {
    return [];
  }
  if (keys.has("oauthCredentialId")) {
    return buildSourceRows();
  }
  throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const rows = resolveSourceRows(projection);
  if (!("failureCount" in projection)) {
    return rows;
  }
  return rows.map((row) => ({ ...(row as Record<string, unknown>), failureCount: 0, nextAttemptAt: null }));
};

const createQuery = (resolve: () => unknown): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (
          onFulfilled: (value: unknown) => unknown,
          onRejected: (reason: unknown) => unknown,
        ) =>
          Bun.sleep(gatedReadMs).then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });
};

const runTransaction = async (
  work: (transaction: unknown) => Promise<unknown>,
): Promise<unknown> => {
  const transaction = {
    delete: () => createQuery(() => []),
    execute: () => Promise.resolve([]),
    insert: () => createQuery(() => []),
    select: (projection: Record<string, unknown>) => createQuery(() => resolveSelect(projection)),
    update: () => createQuery(() => []),
  };
  return await work(transaction);
};

const decideRateLimiterAcquire = (key: string): [number, number] => {
  const served = limiterWaitsServed.get(key) ?? 0;
  if (served >= limiterWaitCount) {
    return [0, 1];
  }
  limiterWaitsServed.set(key, served + 1);
  return [LIMITER_WAIT_MS, LIMITER_WINDOW_OCCUPANCY];
};

vi.mock("@/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: runTransaction,
    update: () => createQuery(() => []),
  },
  flushDatabase: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: runTransaction,
    update: () => createQuery(() => []),
  },
  refreshLockRedis: {
    eval: (script: string, _numberOfKeys: number, ...arguments_: string[]): Promise<unknown> => {
      if (script.includes(RATE_LIMITER_SCRIPT_MARKER)) {
        return Promise.resolve(decideRateLimiterAcquire(arguments_[0] ?? ""));
      }
      return Promise.resolve("acquired");
    },
    get: (): Promise<string | null> => Promise.resolve(null),
  },
  refreshLockStore: {},
}));

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(null),
      },
    }),
  }),
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createDatabase: () => Promise.resolve({}),
  decryptPassword: () => "plaintext",
}));

/* The real limiter is left in place: the key under test is the one it was built with. */
vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSourceFetcher: (params: {
    rateLimiter?: { acquire: (count: number, signal?: AbortSignal) => Promise<void> };
    signal?: AbortSignal;
  }) => ({
    fetchEvents: async () => {
      await params.rateLimiter?.acquire(1, params.signal);
      return { events: [], syncToken: "next-token", windowEnd: null, windowStart: null };
    },
  }),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    ingestSource: async (options: {
      fetchEvents: () => Promise<unknown>;
      withPersistenceTransaction: (
        work: (context: {
          flush: (changes: unknown) => Promise<void>;
          readExistingEvents: () => Promise<unknown[]>;
        }) => Promise<unknown>,
      ) => Promise<unknown>;
    }) => {
      await options.fetchEvents();
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
  gatedReadMs = 0;
  limiterWaitCount = 0;
  limiterWaitsServed.clear();
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

const runTick = async (): Promise<EmittedEvent[]> => {
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
  const events = emitted.filter((candidate) => candidate.operation?.name === "ingest-source");
  if (events.length === 0) {
    throw new Error("no ingest-source wide event was emitted");
  }
  return events;
};

const firstEvent = async (): Promise<EmittedEvent> => {
  const [event] = await runTick();
  if (!event) {
    throw new Error("no ingest-source wide event was emitted");
  }
  return event;
};

describe("database pool attribution", () => {
  it("reports the in-flight and queued query counts for a source's gated queries", async () => {
    const event = await firstEvent();

    expect(event.outcome).toBe("success");
    expect(event.database?.pool?.in_flight).toBeGreaterThanOrEqual(1);
    expect(event.database?.queries?.queued_count).toBe(0);
  });

  it("counts a gated query that waited for a pool permit as queued", async () => {
    sourceCount = CONTENDING_SOURCE_COUNT;
    gatedReadMs = CONTENDED_READ_MS;

    const events = await runTick();

    expect(events.length).toBe(CONTENDING_SOURCE_COUNT);
    const queued = events.filter((event) => (event.database?.queries?.queued_count ?? 0) > 0);
    expect(queued.length).toBeGreaterThan(0);
    const concurrent = events.filter((event) => (event.database?.pool?.in_flight ?? 0) > 1);
    expect(concurrent.length).toBeGreaterThan(0);
  });
});

describe("rate limiter attribution", () => {
  it("records the limiter key the ingest waited on", async () => {
    limiterWaitCount = 1;

    const event = await firstEvent();

    expect(event.wait?.rate_limiter_ms).toBeGreaterThanOrEqual(LIMITER_WAIT_MS - TIMER_SLACK_MS);
    expect(event.wait?.rate_limiter_key).toBe("ratelimit:user-1:google");
  });

  it("records no limiter key when the ingest never waited", async () => {
    const event = await firstEvent();

    expect(event.outcome).toBe("success");
    expect(event.wait?.rate_limiter_key).toBeUndefined();
  });
});
