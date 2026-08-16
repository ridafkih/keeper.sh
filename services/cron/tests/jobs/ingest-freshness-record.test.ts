import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

interface IngestionCounts {
  eventsAdded: number;
  eventsRemoved: number;
  snapshotConfirmed: boolean;
}

interface BackoffRow {
  failureCount: number;
  nextAttemptAt: Date | null;
}

const emitted: WideEvent[] = [];
const updates: Record<string, unknown>[] = [];
let current: WideEvent = { fields: {}, values: {} };
let backoffRow: BackoffRow = { failureCount: 0, nextAttemptAt: null };

const SUCCESSFUL_INGEST = (): IngestionCounts => ({
  eventsAdded: 1,
  eventsRemoved: 0,
  snapshotConfirmed: true,
});
let ingestOutcome: () => IngestionCounts = SUCCESSFUL_INGEST;

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
    count: () => null,
    max: () => null,
    min: () => null,
    append: () => null,
    error: () => null,
    errorFields: (_error: unknown, fields: Record<string, unknown>) => {
      current.fields = { ...current.fields, ...fields };
    },
    flush: () => {
      emitted.push(current);
      current = { fields: {}, values: {} };
    },
    set: (key: string, value: unknown) => {
      current.values[key] = value;
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

const CALDAV_SOURCE = {
  accountId: "account-1",
  calendarId: "calendar-1",
  calendarUrl: "https://dav.example.com/cal/",
  encryptedPassword: "cipher",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowRecordedAt: null,
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  userId: "user-1",
  username: "dav-user",
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  if (keys.has("encryptedPassword")) {
    return [CALDAV_SOURCE];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ ...backoffRow }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
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

const applyBackoffWrite = (values: Record<string, unknown>): void => {
  if (!("ingestFailureCount" in values)) {
    return;
  }
  backoffRow = {
    failureCount: Number(values.ingestFailureCount),
    nextAttemptAt: (values.ingestNextAttemptAt as Date | null) ?? null,
  };
};

const createUpdateQuery = (): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve().then(() => []).then(onFulfilled);
      }
      if (property === "set") {
        return (values: Record<string, unknown>) => {
          updates.push(values);
          applyBackoffWrite(values);
          return createUpdateQuery();
        };
      }
      return () => createUpdateQuery();
    },
  });
};

vi.mock("@/context", () => ({
  database: {
    select: (projection: Record<string, unknown>) =>
      createQuery(() => resolveSelect(projection)),
    transaction: (work: (transaction: unknown) => Promise<unknown>) => work({}),
    update: () => createUpdateQuery(),
  },
  refreshLockRedis: {},
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

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: () => Promise.resolve().then(ingestOutcome),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const wrapQuery = (cause: Error): DrizzleQueryError =>
  new DrizzleQueryError(
    "insert into \"event_states\" (\"id\") values ($1) on conflict do nothing",
    ["event-1"],
    cause,
  );

const closedPool = (): IngestionCounts => {
  throw wrapQuery(postgresError("Connection closed", {
    code: "ERR_POSTGRES_CONNECTION_CLOSED",
  }));
};

const runTick = async (outcome: () => IngestionCounts): Promise<void> => {
  ingestOutcome = outcome;
  emitted.length = 0;
  updates.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const allowImmediateRetry = (): void => {
  backoffRow = { ...backoffRow, nextAttemptAt: null };
};

/*
 * Two-way sync refuses to overwrite or delete a real source event whose stored copy has
 * aged past the freshness bound, so the bound is only as good as the record of when the
 * copy was last confirmed. A clean read that changed nothing is still a confirmation, and
 * a tick that does not record it reads afterwards as a source nobody has looked at.
 */
describe("a clean ingest records when the stored copy was last confirmed", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    current = { fields: {}, values: {} };
    backoffRow = { failureCount: 0, nextAttemptAt: null };
  });

  it("records the read on a tick that had no backoff to clear", async () => {
    await runTick(SUCCESSFUL_INGEST);

    const recorded = updates.filter((values) => "ingestLastSucceededAt" in values);
    expect(recorded.length).toBe(1);
    expect(recorded[0]?.ingestLastSucceededAt).toBeInstanceOf(Date);
  });

  it("records nothing for a tick the provider refused", async () => {
    await runTick(closedPool);

    expect(updates.some((values) => "ingestLastSucceededAt" in values)).toBe(false);
  });

  it("records the read again once a failing source recovers", async () => {
    await runTick(closedPool);
    allowImmediateRetry();

    await runTick(SUCCESSFUL_INGEST);

    expect(updates.some((values) => "ingestLastSucceededAt" in values)).toBe(true);
  });
});
