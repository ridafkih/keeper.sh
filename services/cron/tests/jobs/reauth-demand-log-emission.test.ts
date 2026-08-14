import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EmittedEvent {
  event_name?: string;
  operation?: { name?: string; type?: string };
  outcome?: string;
  provider?: { account_id?: string };
  reauth?: {
    action?: string;
    deciding_vote?: string;
    previous?: boolean;
    provenance?: string;
    signal?: string;
    transitioned?: boolean;
    votes?: Record<string, number>;
  };
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

let accountNeedsReauthentication = false;
let accountDemandSource: string | null = null;

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

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("encryptedPassword") || keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    return [{ failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("oauthCredentialId")) {
    return [{
      ...baseSource,
      calendarId: "calendar-primary",
      externalCalendarId: "primary",
      reauthenticationSource: accountDemandSource,
    }];
  }
  if (keys.has("needsReauthentication")) {
    return [{
      needsReauthentication: accountNeedsReauthentication,
      reauthenticationSource: accountDemandSource,
    }];
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

const applyDemandWrite = (values: Record<string, unknown>): unknown[] => {
  if (!("needsReauthentication" in values)) {
    if ("ingestFailureCount" in values) {
      return [{ id: "calendar-primary" }];
    }
    return [];
  }
  const next = values.needsReauthentication === true;
  if (next === accountNeedsReauthentication) {
    return [];
  }
  accountNeedsReauthentication = next;
  return [{ id: "account-1" }];
};

const createUpdateQuery = (pending?: Record<string, unknown>): unknown => {
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
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

const emitted: EmittedEvent[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

const captureLine = (chunk: unknown): void => {
  for (const line of String(chunk).split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    emitted.push(JSON.parse(line) as EmittedEvent);
  }
};

beforeEach(() => {
  emitted.length = 0;
  accountNeedsReauthentication = false;
  accountDemandSource = null;
  sourcePullSucceeds = true;
  process.stdout.write = ((chunk: unknown) => {
    captureLine(chunk);
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const runTick = async (): Promise<void> => {
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const demandEvents = (): EmittedEvent[] =>
  emitted.filter((event) => event.operation?.name === "reauthentication-demand");

describe("re-authentication demand events through the real logging stack", () => {
  it("lands a raise decision as its own parseable log line", async () => {
    sourcePullSucceeds = false;

    await runTick();

    const [event] = demandEvents();
    if (!event) {
      throw new Error("no reauthentication-demand log line was emitted");
    }
    expect(event.event_name).toBe("wide_event");
    expect(event.operation).toEqual({ name: "reauthentication-demand", type: "job" });
    expect(event.provider).toEqual({ account_id: "account-1" });
    expect(event.outcome).toBe("success");
    expect(event.reauth).toEqual({
      action: "raise",
      deciding_vote: "request-rejected",
      previous: false,
      provenance: "source-ingest",
      signal: "request-rejected",
      transitioned: true,
      votes: {
        abstain: 0,
        authenticated: 0,
        credential_rejected: 0,
        request_rejected: 1,
      },
    });
  });

  it("lands a clear decision as its own parseable log line", async () => {
    accountNeedsReauthentication = true;
    accountDemandSource = "source-ingest";

    await runTick();

    const [event] = demandEvents();
    if (!event) {
      throw new Error("no reauthentication-demand log line was emitted");
    }
    expect(event.reauth).toEqual({
      action: "clear",
      deciding_vote: "authenticated",
      previous: true,
      provenance: "source-ingest",
      recorded_provenance: "source-ingest",
      transitioned: true,
      votes: {
        abstain: 0,
        authenticated: 1,
        credential_rejected: 0,
        request_rejected: 0,
      },
    });
  });
});
