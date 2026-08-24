import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EmittedEvent {
  flush?: { slot_occupancy_ms?: number; unattributed_ms?: number };
  operation?: { name?: string };
  outcome?: string;
  wait?: { advisory_lock_ms?: number };
  work?: { db_commit_ms?: number };
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
// The third statement of the transaction is pg_advisory_xact_lock.
const ADVISORY_LOCK_STATEMENT_INDEX = 3;

/* Stands in for the 133s slot occupancy against 17s of instrumented statements. */
const UNINSTRUMENTED_HOLD_MS = 240;
const ADVISORY_WAIT_MS = 40;
const COMMIT_MS = 30;

/*
 * Bun.sleep can return a fraction of a millisecond early, so an exact floor would
 * assert timer granularity rather than attribution.
 */
const TIMER_SLACK_MS = 5;
/* An accounted flush still pays for the unmeasured set_config statements around it. */
const FULLY_ACCOUNTED_CEILING_MS = 30;

const chargedAtLeast = (injectedMs: number): number => injectedMs - TIMER_SLACK_MS;

let advisoryWaitMs = 0;
let commitMs = 0;
let uninstrumentedHoldMs = 0;

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
    return [{
      ...baseSource,
      calendarId: CALENDAR_ID,
      externalCalendarId: "primary",
      reauthenticationSource: null,
    }];
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
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onFulfilled).catch(onRejected);
      }
      return () => createQuery(resolve);
    },
  });
};

const runTransaction = async (work: (transaction: unknown) => Promise<unknown>): Promise<unknown> => {
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
    eval: (): Promise<unknown> => Promise.resolve("acquired"),
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
        /* Holds the writer slot without touching an instrumented statement. */
        await Bun.sleep(uninstrumentedHoldMs);
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
  advisoryWaitMs = 0;
  commitMs = 0;
  uninstrumentedHoldMs = 0;
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

const runTick = async (): Promise<EmittedEvent> => {
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
  const event = emitted.find((candidate) => candidate.operation?.name === "ingest-source");
  if (!event) {
    throw new Error("no ingest-source wide event was emitted");
  }
  return event;
};

describe("flush unattributed time", () => {
  it("reports the slot time no instrumented statement explains", async () => {
    advisoryWaitMs = ADVISORY_WAIT_MS;
    commitMs = COMMIT_MS;
    uninstrumentedHoldMs = UNINSTRUMENTED_HOLD_MS;

    const event = await runTick();

    expect(event.outcome).toBe("success");
    expect(event.flush?.unattributed_ms).toBeGreaterThanOrEqual(
      chargedAtLeast(UNINSTRUMENTED_HOLD_MS),
    );
    expect(event.flush?.unattributed_ms ?? 0).toBeLessThanOrEqual(
      event.flush?.slot_occupancy_ms ?? 0,
    );
  });

  it("reports near zero when every statement accounts for the slot", async () => {
    advisoryWaitMs = ADVISORY_WAIT_MS;
    commitMs = COMMIT_MS;

    const event = await runTick();

    expect(event.wait?.advisory_lock_ms).toBeGreaterThanOrEqual(chargedAtLeast(ADVISORY_WAIT_MS));
    expect(event.work?.db_commit_ms).toBeGreaterThanOrEqual(chargedAtLeast(COMMIT_MS));
    expect(event.flush?.unattributed_ms).toBeDefined();
    expect(event.flush?.unattributed_ms ?? -1).toBeLessThanOrEqual(FULLY_ACCOUNTED_CEILING_MS);
  });

  it("never reports a negative residual", async () => {
    advisoryWaitMs = ADVISORY_WAIT_MS;

    const event = await runTick();

    expect(event.flush?.unattributed_ms ?? -1).toBeGreaterThanOrEqual(0);
  });
});
