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

const applyWrite = (values: Record<string, unknown>): void => {
  if (!("needsReauthentication" in values)) {
    return;
  }
  const next = values.needsReauthentication === true;
  if (next === accountNeedsReauthentication) {
    return;
  }
  writes.push(values);
  accountNeedsReauthentication = next;
  if ("reauthenticationSource" in values) {
    const source = values.reauthenticationSource;
    if (typeof source === "string") {
      accountDemandSource = source;
      return;
    }
    accountDemandSource = null;
  }
};

const createUpdateQuery = (pending?: Record<string, unknown>): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (pending) {
                applyWrite(pending);
              }
              return [];
            })
            .then(onFulfilled);
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

const startWithDemand = (source: string | null): void => {
  accountNeedsReauthentication = true;
  accountDemandSource = source;
};

describe("a successful source pull meeting a re-authentication demand it did not raise", () => {
  beforeEach(() => {
    emitted.length = 0;
    writes.length = 0;
    current = { fields: {}, values: {} };
    accountNeedsReauthentication = false;
    accountDemandSource = null;
    sourcePullSucceeds = true;
  });

  it("leaves a destination write-scope demand standing while the read-only pull succeeds", async () => {
    startWithDemand("destination-grant");

    await runTick();

    expect(accountNeedsReauthentication).toBe(true);
    expect(writes).toEqual([]);
  });

  it("keeps leaving it standing tick after tick", async () => {
    startWithDemand("destination-grant");

    await runTick();
    await runTick();
    await runTick();

    expect(accountNeedsReauthentication).toBe(true);
    expect(writes).toEqual([]);
  });

  it("clears a token refresh demand, which a working pull does adjudicate and nothing else clears", async () => {
    startWithDemand("token-refresh");

    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("clears a demand the ingest run itself raised", async () => {
    startWithDemand("source-ingest");

    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("clears a demand raised by the CalDAV source credential path", async () => {
    startWithDemand("source-credentials");

    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("clears a demand with no recorded provenance", async () => {
    startWithDemand(null);

    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("records its own provenance when it raises the demand", async () => {
    sourcePullSucceeds = false;

    await runTick();

    expect(accountNeedsReauthentication).toBe(true);
    expect(accountDemandSource).toBe("source-ingest");
  });

  it("drops the provenance it recorded once it clears its own demand", async () => {
    sourcePullSucceeds = false;
    await runTick();

    sourcePullSucceeds = true;
    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
    expect(accountDemandSource).toBeNull();
  });
});
