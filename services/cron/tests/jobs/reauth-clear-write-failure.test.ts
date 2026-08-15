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
let clearWriteFails = false;
let pushedUserIds: string[] = [];

const SUCCESSFUL_INGEST = (): IngestionCounts => ({ eventsAdded: 3, eventsRemoved: 1 });
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
  enqueueDestinationSyncsForUsers: (userIds: string[]) => {
    pushedUserIds = [...pushedUserIds, ...userIds];
    return Promise.resolve(null);
  },
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

const postgresError = (
  message: string,
  fields: Record<string, unknown>,
): Error & Record<string, unknown> =>
  Object.assign(new Error(message), { name: "PostgresError" }, fields);

const clearWriteDeadlock = (): DrizzleQueryError =>
  new DrizzleQueryError(
    "update \"calendar_accounts\" set \"needs_reauthentication\" = $1 where (\"id\" = $2 and \"needs_reauthentication\" = $3)",
    [false, "account-1", true],
    postgresError("deadlock detected", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40P01",
    }),
  );

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

const createUpdateQuery = (pending?: Record<string, unknown>): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (
          onFulfilled: (value: unknown) => unknown,
          onRejected: (reason: unknown) => unknown,
        ) =>
          Promise.resolve()
            .then(() => {
              if (
                clearWriteFails
                && pending
                && pending.needsReauthentication === false
              ) {
                throw clearWriteDeadlock();
              }
              if (pending) {
                updates.push(pending);
                applyWrite(pending);
              }
              return [];
            })
            .then(onFulfilled)
            .catch(onRejected);
      }
      if (property === "set") {
        return (values: Record<string, unknown>) => createUpdateQuery(values);
      }
      return () => createUpdateQuery(pending);
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

const runTick = async (): Promise<void> => {
  emitted.length = 0;
  updates.length = 0;
  pushedUserIds = [];
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const sourceEvent = (): WideEvent => {
  const event = emitted.find(({ values }) => values["operation.name"] === "ingest-source");
  if (!event) {
    throw new Error("no per-source wide event was emitted");
  }
  return event;
};

describe("a failing re-authentication clear write on the ingest success path", () => {
  beforeEach(() => {
    emitted.length = 0;
    updates.length = 0;
    pushedUserIds = [];
    current = { fields: {}, values: {} };
    backoffRow = { failureCount: 0, nextAttemptAt: null };
    accountNeedsReauthentication = false;
    clearWriteFails = false;
    ingestOutcome = SUCCESSFUL_INGEST;
  });

  it("reports the ingest as successful when the clear write succeeds", async () => {
    await runTick();

    expect(sourceEvent().values.outcome).toBe("success");
    expect(backoffRow.failureCount).toBe(0);
    expect(pushedUserIds).toContain("user-1");
  });

  it("does not park a successfully ingested calendar behind ingest backoff", async () => {
    clearWriteFails = true;

    await runTick();

    expect(backoffRow).toEqual({ failureCount: 0, nextAttemptAt: null });
  });

  it("still pushes the events it already persisted", async () => {
    clearWriteFails = true;

    await runTick();

    expect(pushedUserIds).toContain("user-1");
  });

  it("leaves an existing demand raised when the clear write keeps failing", async () => {
    accountNeedsReauthentication = true;
    clearWriteFails = true;

    await runTick();

    expect(accountNeedsReauthentication).toBe(true);
    expect(pushedUserIds).toContain("user-1");
  });

  it("converges instead of escalating backoff on every healthy tick", async () => {
    clearWriteFails = true;

    for (let tick = 0; tick < 4; tick += 1) {
      backoffRow = { ...backoffRow, nextAttemptAt: null };
      await runTick();
    }

    expect(backoffRow.failureCount).toBeLessThanOrEqual(1);
  });
});
