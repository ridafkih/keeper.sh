import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

interface IngestionCounts {
  eventsAdded: number;
  eventsRemoved: number;
}

interface BackoffRow {
  failureCount: number;
  nextAttemptAt: Date | null;
}

const emitted: WideEvent[] = [];
const updates: Record<string, unknown>[] = [];
let current: WideEvent = { fields: {}, values: {} };
let backoffRow: BackoffRow = { failureCount: 0, nextAttemptAt: null };
let accountNeedsReauthentication = false;

const SUCCESSFUL_INGEST = (): IngestionCounts => ({ eventsAdded: 1, eventsRemoved: 0 });
let ingestOutcome: () => IngestionCounts = SUCCESSFUL_INGEST;

vi.mock("@/utils/logging", () => ({
  context: (run: () => Promise<unknown>) => run(),
  widelog: {
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

const applyWrite = (values: Record<string, unknown>): void => {
  if ("ingestFailureCount" in values) {
    backoffRow = {
      failureCount: Number(values.ingestFailureCount),
      nextAttemptAt: (values.ingestNextAttemptAt as Date | null) ?? null,
    };
  }
  if ("needsReauthentication" in values) {
    accountNeedsReauthentication = values.needsReauthentication === true;
  }
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
          applyWrite(values);
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
    "update \"calendar_accounts\" set \"needs_reauthentication\" = $1 where \"id\" = $2",
    [true, "account-1"],
    cause,
  );

const transientProviderUnauthorized = (): IngestionCounts => {
  throw Object.assign(new Error("CalDAV request failed"), { status: 401 });
};

const deadlock = (): IngestionCounts => {
  throw wrapQuery(postgresError(
    "deadlock detected",
    { code: "ERR_POSTGRES_SERVER_ERROR", errno: "40P01" },
  ));
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

const sourceEvent = (): WideEvent => {
  const event = emitted.find(({ values }) => values["operation.name"] === "ingest-source");
  if (!event) {
    throw new Error("no per-source wide event was emitted");
  }
  return event;
};

describe("caldav re-authentication demands across failure and recovery", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    current = { fields: {}, values: {} };
    backoffRow = { failureCount: 0, nextAttemptAt: null };
    accountNeedsReauthentication = false;
  });

  it("raises the demand on a provider 401", async () => {
    await runTick(transientProviderUnauthorized);

    expect(sourceEvent().fields.slug).toBe("provider-auth-failed");
    expect(accountNeedsReauthentication).toBe(true);
  });

  it("clears the demand once the same credentials start working again", async () => {
    await runTick(transientProviderUnauthorized);
    expect(accountNeedsReauthentication).toBe(true);
    allowImmediateRetry();

    await runTick(SUCCESSFUL_INGEST);

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("clears the demand even after several healthy ticks", async () => {
    await runTick(transientProviderUnauthorized);
    for (let tick = 0; tick < 3; tick += 1) {
      allowImmediateRetry();
      await runTick(SUCCESSFUL_INGEST);
    }

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("does not raise the demand when only our own database is failing", async () => {
    await runTick(deadlock);

    expect(sourceEvent().fields.slug).toBe("db-query-failed");
    expect(accountNeedsReauthentication).toBe(false);
  });

  it("does not raise the demand when a database failure follows a recovered 401", async () => {
    await runTick(transientProviderUnauthorized);
    allowImmediateRetry();
    await runTick(SUCCESSFUL_INGEST);
    allowImmediateRetry();
    await runTick(deadlock);

    expect(updates.some((values) => values.needsReauthentication === true)).toBe(false);
  });

  it("does not park the source behind ingest backoff while the provider rejects the credentials", async () => {
    await runTick(transientProviderUnauthorized);

    expect(backoffRow).toEqual({ failureCount: 0, nextAttemptAt: null });
  });
});
