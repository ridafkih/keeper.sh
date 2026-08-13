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

const rejectedPoolPassword = (): IngestionCounts => {
  throw wrapQuery(postgresError(
    "password authentication failed for user \"keeper\"",
    { code: "ERR_POSTGRES_SERVER_ERROR", errno: "28P01" },
  ));
};

const sourceEvent = (): WideEvent => {
  const event = emitted.find(({ values }) => values["operation.name"] === "ingest-source");
  if (!event) {
    throw new Error("no per-source wide event was emitted");
  }
  return event;
};

describe("caldav ingest labelling of our own pool failures", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    current = { fields: {}, values: {} };
  });

  it("labels a closed pool connection as a database failure", async () => {
    await runTick(() => {
      throw wrapQuery(postgresError("Connection closed", {
        code: "ERR_POSTGRES_CONNECTION_CLOSED",
      }));
    });

    expect(sourceEvent().fields.slug).toBe("db-connection-unavailable");
  });

  it("labels a rejected pool password as a database failure, not a provider auth failure", async () => {
    await runTick(rejectedPoolPassword);

    expect(sourceEvent().fields.slug).toBe("db-connection-unavailable");
  });

  it("does not force a caldav account to re-authenticate because our pool rejected us", async () => {
    await runTick(rejectedPoolPassword);

    expect(updates.some((values) => values.needsReauthentication === true)).toBe(false);
  });

  it("records the sqlstate of the pool failure on the source event", async () => {
    await runTick(rejectedPoolPassword);

    expect(sourceEvent().values["db.error_sqlstate"]).toBe("28P01");
  });

  it("still marks a genuine caldav 401 as a provider auth failure", async () => {
    await runTick(() => {
      throw Object.assign(new Error("CalDAV request failed"), { status: 401 });
    });

    expect(sourceEvent().fields.slug).toBe("provider-auth-failed");
    expect(updates.some((values) => values.needsReauthentication === true)).toBe(true);
  });

  it("leaves no re-authentication demand behind once the pool recovers", async () => {
    await runTick(rejectedPoolPassword);
    const demandedOnFailure = updates.some((values) => values.needsReauthentication === true);

    await runTick(SUCCESSFUL_INGEST);
    const demandedOnRecovery = updates.some((values) => values.needsReauthentication === true);

    expect([demandedOnFailure, demandedOnRecovery]).toEqual([false, false]);
  });

  it("converges on the same answer across repeated ticks of the same pool failure", async () => {
    const slugs: unknown[] = [];
    for (let tick = 0; tick < 3; tick += 1) {
      await runTick(rejectedPoolPassword);
      slugs.push(sourceEvent().fields.slug);
    }

    expect(new Set(slugs)).toEqual(new Set(["db-connection-unavailable"]));
  });
});
