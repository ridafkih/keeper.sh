import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const flagWrites: boolean[] = [];
const enqueuedUserIds: string[][] = [];
let current: WideEvent = { fields: {}, values: {} };
let updateAttempts = 0;
let failingUpdateAttempt = 0;

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
  enqueueDestinationSyncsForUsers: (userIds: Set<string>) => {
    enqueuedUserIds.push([...userIds]);
    return Promise.resolve(null);
  },
}));

const baseSource = {
  encryptedPassword: "cipher",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowRecordedAt: null,
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  username: "dav-user",
};

const FIRST_ACCOUNT_CALENDAR = {
  ...baseSource,
  accountId: "account-first",
  calendarId: "calendar-first",
  calendarUrl: "https://dav.example.com/first/",
  userId: "user-first",
};

const SECOND_ACCOUNT_CALENDAR = {
  ...baseSource,
  accountId: "account-second",
  calendarId: "calendar-second",
  calendarUrl: "https://dav.example.com/second/",
  userId: "user-second",
};

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  if (keys.has("encryptedPassword") && keys.has("calendarId")) {
    return [FIRST_ACCOUNT_CALENDAR, SECOND_ACCOUNT_CALENDAR];
  }
  if (keys.has("encryptedPassword")) {
    return [FIRST_ACCOUNT_CALENDAR];
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

const createDeadlock = (): Error =>
  Object.assign(
    new Error(
      "Failed query: update \"calendar_accounts\" set \"needs_reauthentication\" = $1"
      + " where \"id\" = $2\nparams: false,account-first",
    ),
    {
      cause: Object.assign(new Error("deadlock detected"), {
        code: "ERR_POSTGRES_SERVER_ERROR",
        errno: "40P01",
      }),
    },
  );

const createUpdateQuery = (pending?: Record<string, unknown>): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (!pending || !("needsReauthentication" in pending)) {
                return [];
              }
              updateAttempts += 1;
              if (updateAttempts === failingUpdateAttempt) {
                throw createDeadlock();
              }
              flagWrites.push(pending.needsReauthentication === true);
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
  ingestSource: () => Promise.resolve({ eventsAdded: 1, eventsRemoved: 0 }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = async (): Promise<unknown> => {
  emitted.length = 0;
  updateAttempts = 0;
  return await Promise.resolve(ingestSourcesJob.callback())
    .then(() => null)
    .catch((error: unknown) => error);
};

describe("a failing re-authentication settlement write", () => {
  beforeEach(() => {
    emitted.length = 0;
    flagWrites.length = 0;
    enqueuedUserIds.length = 0;
    current = { fields: {}, values: {} };
    updateAttempts = 0;
    failingUpdateAttempt = 0;
  });

  it("does not stop the other accounts in the same batch from settling", async () => {
    failingUpdateAttempt = 1;

    await runTick();

    expect(flagWrites).toEqual([false]);
  });

  it("does not fail the ingest job", async () => {
    failingUpdateAttempt = 1;

    const failure = await runTick();

    expect(failure).toBe(null);
  });

  it("still enqueues the destination pushes the successful ingests earned", async () => {
    failingUpdateAttempt = 1;

    await runTick();

    expect(enqueuedUserIds).toEqual([["user-first"]]);
  });

  it("labels the failed settlement write as our own database failure", async () => {
    failingUpdateAttempt = 1;

    await runTick();

    expect(
      emitted.some(({ fields }) => fields.slug === "db-query-failed"),
    ).toBe(true);
  });

  it("writes both accounts again on the next tick without churn once they settle", async () => {
    failingUpdateAttempt = 1;
    await runTick();
    flagWrites.length = 0;

    failingUpdateAttempt = 0;
    await runTick();

    expect(flagWrites).toEqual([false, false]);
  });
});
