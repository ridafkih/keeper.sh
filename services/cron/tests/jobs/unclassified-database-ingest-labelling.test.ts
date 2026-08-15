import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const updates: Record<string, unknown>[] = [];
let current: WideEvent = { fields: {}, values: {} };
interface IngestionCounts {
  eventsAdded: number;
  eventsRemoved: number;
}

const SUCCESSFUL_INGEST = (): IngestionCounts => ({ eventsAdded: 0, eventsRemoved: 0 });
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
  if (keys.has("encryptedPassword") && keys.has("accountId")) {
    return [CALDAV_SOURCE];
  }
  if (keys.has("encryptedPassword")) {
    return [CALDAV_SOURCE];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
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
    "select \"event_states\".\"id\" from \"event_states\" where \"calendar_id\" = $1",
    ["calendar-1"],
    cause,
  );

const runTick = async (outcome: () => IngestionCounts): Promise<void> => {
  ingestOutcome = outcome;
  emitted.length = 0;
  updates.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const sourceEvent = (): WideEvent => {
  const event = emitted.find(({ values }) => values["operation.name"] === "ingest-source");
  if (!event) {
    throw new Error("no per-source wide event was emitted");
  }
  return event;
};

const UNCLASSIFIED_DATABASE_FAILURES: {
  label: string;
  cause: Error & Record<string, unknown>;
}[] = [
  {
    label: "deadlock on an upsert",
    cause: postgresError("deadlock detected", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40P01",
    }),
  },
  {
    label: "unique violation on an upsert",
    cause: postgresError(
      "duplicate key value violates unique constraint \"event_states_pkey\"",
      { code: "ERR_POSTGRES_SERVER_ERROR", constraint: "event_states_pkey", errno: "23505" },
    ),
  },
  {
    label: "serialization failure",
    cause: postgresError("could not serialize access due to concurrent update", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40001",
    }),
  },
  {
    label: "check-constraint violation on the sync range",
    cause: postgresError(
      "new row for relation \"calendars\" violates check constraint \"calendars_sync_future_range_check\"",
      {
        code: "ERR_POSTGRES_SERVER_ERROR",
        constraint: "calendars_sync_future_range_check",
        errno: "23514",
      },
    ),
  },
];

describe("caldav ingest labelling of database failures the pool classifier does not name", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    current = { fields: {}, values: {} };
  });

  it.each(UNCLASSIFIED_DATABASE_FAILURES)(
    "does not attribute a $label to the provider api",
    async ({ cause }) => {
      await runTick(() => {
        throw wrapQuery(cause);
      });

      expect(sourceEvent().fields.slug).toBe("db-query-failed");
    },
  );

  it.each(UNCLASSIFIED_DATABASE_FAILURES)(
    "records the sqlstate of a $label on the source event",
    async ({ cause }) => {
      await runTick(() => {
        throw wrapQuery(cause);
      });

      expect(sourceEvent().values["db.error_sqlstate"]).toBe(String(cause.errno));
    },
  );

  it("does not force a caldav account to re-authenticate because a write deadlocked", async () => {
    await runTick(() => {
      throw wrapQuery(postgresError("deadlock detected", {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }));
    });

    expect(updates.some((values) => values.needsReauthentication === true)).toBe(false);
  });

  it("still labels a genuine provider server error as a provider api failure", async () => {
    await runTick(() => {
      throw Object.assign(new Error("CalDAV request failed"), { status: 500 });
    });

    expect(sourceEvent().fields.slug).toBe("provider-api-error");
  });
});
