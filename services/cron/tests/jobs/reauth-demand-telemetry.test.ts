import { DrizzleQueryError } from "drizzle-orm/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const writes: Record<string, unknown>[] = [];
let current: WideEvent = { fields: {}, values: {} };
let accountNeedsReauthentication = false;
let accountDemandSource: string | null = null;
let demandWriteFails = false;

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

const readSource = (): Record<string, unknown> => ({
  ...baseSource,
  calendarId: "calendar-primary",
  externalCalendarId: "primary",
  reauthenticationSource: accountDemandSource,
});

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("encryptedPassword")) {
    return [];
  }
  if (keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("oauthCredentialId")) {
    return [readSource()];
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

const demandWriteDeadlock = (): DrizzleQueryError =>
  new DrizzleQueryError(
    "update \"calendar_accounts\" set \"needs_reauthentication\" = $1",
    [],
    postgresError("deadlock detected", {
      code: "ERR_POSTGRES_SERVER_ERROR",
      errno: "40P01",
    }),
  );

const applyDemandWrite = (values: Record<string, unknown>): unknown[] => {
  if (!("needsReauthentication" in values)) {
    return [];
  }
  if (demandWriteFails) {
    throw demandWriteDeadlock();
  }
  const next = values.needsReauthentication === true;
  if (next === accountNeedsReauthentication) {
    return [];
  }
  writes.push(values);
  accountNeedsReauthentication = next;
  accountDemandSource = null;
  if (typeof values.reauthenticationSource === "string") {
    accountDemandSource = values.reauthenticationSource;
  }
  return [{ id: "account-1" }];
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
              if (pending) {
                return applyDemandWrite(pending);
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

let sourcePullSucceeds = true;

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: (): Promise<{ eventsAdded: number; eventsRemoved: number }> =>
    Promise.resolve().then(() => {
      if (sourcePullSucceeds) {
        return { eventsAdded: 1, eventsRemoved: 0 };
      }
      throw Object.assign(new Error("Failed to fetch events: 401"), {
        authRequired: true,
        status: 401,
      });
    }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = async (): Promise<void> => {
  emitted.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const demandEvent = (): WideEvent => {
  const event = emitted.find(
    ({ values }) => values["operation.name"] === "reauthentication-demand",
  );
  if (!event) {
    throw new Error("no reauthentication-demand wide event was emitted");
  }
  return event;
};

describe("re-authentication demand telemetry at ingest vote resolution", () => {
  beforeEach(() => {
    emitted.length = 0;
    writes.length = 0;
    current = { fields: {}, values: {} };
    accountNeedsReauthentication = false;
    accountDemandSource = null;
    demandWriteFails = false;
    sourcePullSucceeds = true;
  });

  it("logs an unopposed single-calendar rejection as such when it raises", async () => {
    sourcePullSucceeds = false;

    await runTick();

    const { values } = demandEvent();
    expect(values["operation.type"]).toBe("job");
    expect(values["provider.account_id"]).toBe("account-1");
    expect(values["reauth.action"]).toBe("raise");
    expect(values["reauth.provenance"]).toBe("source-ingest");
    expect(values["reauth.deciding_vote"]).toBe("request-rejected");
    expect(values["reauth.signal"]).toBe("request-rejected");
    expect(values["reauth.votes.request_rejected"]).toBe(1);
    expect(values["reauth.votes.credential_rejected"]).toBe(0);
    expect(values["reauth.votes.authenticated"]).toBe(0);
    expect(values["reauth.votes.abstain"]).toBe(0);
    expect(values["reauth.previous"]).toBe(false);
    expect(values["reauth.transitioned"]).toBe(true);
    expect(values.outcome).toBe("success");
    expect(accountNeedsReauthentication).toBe(true);
  });

  it("logs a clear carrying the provenance the demand was standing under", async () => {
    accountNeedsReauthentication = true;
    accountDemandSource = "token-refresh";

    await runTick();

    const { values } = demandEvent();
    expect(values["reauth.action"]).toBe("clear");
    expect(values["reauth.provenance"]).toBe("source-ingest");
    expect(values["reauth.recorded_provenance"]).toBe("token-refresh");
    expect(values["reauth.deciding_vote"]).toBe("authenticated");
    expect(values["reauth.votes.authenticated"]).toBe(1);
    expect(values["reauth.previous"]).toBe(true);
    expect(values["reauth.transitioned"]).toBe(true);
    expect(accountNeedsReauthentication).toBe(false);
  });

  it("logs a suppressed clear when the standing demand is not ingest-adjudicable", async () => {
    accountNeedsReauthentication = true;
    accountDemandSource = "destination-grant";

    await runTick();

    const { values } = demandEvent();
    expect(values["reauth.action"]).toBe("clear");
    expect(values["reauth.suppressed"]).toBe(true);
    expect(values["reauth.recorded_provenance"]).toBe("destination-grant");
    expect(values.outcome).toBe("skipped");
    expect(writes).toEqual([]);
    expect(accountNeedsReauthentication).toBe(true);
  });

  it("distinguishes a no-op raise over an already-raised flag from a real transition", async () => {
    accountNeedsReauthentication = true;
    accountDemandSource = "source-ingest";
    sourcePullSucceeds = false;

    await runTick();

    const { values } = demandEvent();
    expect(values["reauth.action"]).toBe("raise");
    expect(values["reauth.previous"]).toBe(true);
    expect(values["reauth.transitioned"]).toBe(false);
    expect(writes).toEqual([]);
  });

  it("reports a failing demand write on the demand event without failing the tick", async () => {
    accountNeedsReauthentication = true;
    accountDemandSource = "source-ingest";
    demandWriteFails = true;

    await runTick();

    const event = demandEvent();
    expect(event.values.outcome).toBe("error");
    expect(event.fields.slug).toBe("db-query-failed");
    expect(accountNeedsReauthentication).toBe(true);
  });
});
