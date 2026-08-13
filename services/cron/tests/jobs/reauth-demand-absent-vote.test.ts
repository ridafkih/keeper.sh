import { beforeEach, describe, expect, it, vi } from "vitest";

interface WideEvent {
  fields: Record<string, unknown>;
  values: Record<string, unknown>;
}

const emitted: WideEvent[] = [];
const flagWrites: boolean[] = [];
let current: WideEvent = { fields: {}, values: {} };
let accountNeedsReauthentication = false;

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

const baseSource = {
  accountId: "account-1",
  encryptedPassword: "cipher",
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowRecordedAt: null,
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  userId: "user-1",
  username: "dav-user",
};

const REVOKED_SHARE_CALENDAR = {
  ...baseSource,
  calendarId: "calendar-revoked",
  calendarUrl: "https://dav.example.com/shared/",
};

const HEALTHY_CALENDAR = {
  ...baseSource,
  calendarId: "calendar-healthy",
  calendarUrl: "https://dav.example.com/personal/",
};

type RevokedOutcome =
  | "unauthorized"
  | "unavailable"
  | "locked"
  | "account-unauthorized"
  | "account-unavailable"
  | "account-locked";

let revokedOutcome: RevokedOutcome = "unauthorized";

const resolveSelect = (projection: Record<string, unknown>): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  if (keys.has("encryptedPassword") && keys.has("calendarId")) {
    return [REVOKED_SHARE_CALENDAR, HEALTHY_CALENDAR];
  }
  if (keys.has("encryptedPassword")) {
    return [REVOKED_SHARE_CALENDAR];
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

const applyWrite = (values: Record<string, unknown>): void => {
  if (!("needsReauthentication" in values)) {
    return;
  }
  const next = values.needsReauthentication === true;
  if (next === accountNeedsReauthentication) {
    return;
  }
  accountNeedsReauthentication = next;
  flagWrites.push(next);
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

let lockedCalendarIds = new Set<string>();

const acquireLock = (key: string): Record<string, unknown> => {
  if ([...lockedCalendarIds].some((calendarId) => key.endsWith(calendarId))) {
    return { acquired: false };
  }
  return {
    acquired: true,
    handle: {
      isCurrent: () => Promise.resolve(true),
      release: () => Promise.resolve(null),
    },
  };
};

vi.mock("@keeper.sh/sync", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createSyncLock: () => ({
    acquire: (key: string) => Promise.resolve(acquireLock(key)),
  }),
}));

vi.mock("@keeper.sh/database", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createDatabase: () => Promise.resolve({}),
  decryptPassword: () => "plaintext",
}));

const createRevokedFailure = (): Error => {
  if (revokedOutcome === "unavailable" || revokedOutcome === "account-unavailable") {
    return Object.assign(new Error("CalDAV request failed"), { status: 503 });
  }
  return Object.assign(new Error("CalDAV request failed"), { status: 401 });
};

const failsEveryCalendar = (): boolean => revokedOutcome.startsWith("account-");

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: ({ calendarId }: { calendarId: string }) =>
    Promise.resolve().then(() => {
      if (failsEveryCalendar() || calendarId === REVOKED_SHARE_CALENDAR.calendarId) {
        throw createRevokedFailure();
      }
      return { eventsAdded: 1, eventsRemoved: 0 };
    }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const resolveLockedCalendarIds = (outcome: RevokedOutcome): Set<string> => {
  if (outcome === "locked") {
    return new Set([REVOKED_SHARE_CALENDAR.calendarId]);
  }
  if (outcome === "account-locked") {
    return new Set([REVOKED_SHARE_CALENDAR.calendarId, HEALTHY_CALENDAR.calendarId]);
  }
  return new Set();
};

const runTick = async (outcome: RevokedOutcome): Promise<void> => {
  emitted.length = 0;
  revokedOutcome = outcome;
  lockedCalendarIds = resolveLockedCalendarIds(outcome);
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

describe("an account whose rejecting calendar cannot always cast a vote", () => {
  beforeEach(() => {
    emitted.length = 0;
    flagWrites.length = 0;
    current = { fields: {}, values: {} };
    accountNeedsReauthentication = false;
    lockedCalendarIds = new Set();
  });

  it("keeps the demand raised across a tick where no calendar of the account could vote", async () => {
    await runTick("account-unauthorized");
    expect(accountNeedsReauthentication).toBe(true);

    await runTick("account-unavailable");

    expect(accountNeedsReauthentication).toBe(true);
  });

  it("clears the demand on a tick where a sibling authenticates and the rejecting calendar fails for another reason", async () => {
    await runTick("account-unauthorized");
    expect(accountNeedsReauthentication).toBe(true);

    await runTick("unavailable");

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("does not oscillate when the provider alternates between 401 and 503", async () => {
    await runTick("account-unauthorized");
    await runTick("unavailable");
    expect(flagWrites).toEqual([true, false]);
    flagWrites.length = 0;

    await runTick("unauthorized");
    await runTick("unavailable");
    await runTick("unauthorized");
    await runTick("unavailable");

    expect(flagWrites).toEqual([]);
  });

  it("keeps the demand raised across a tick where another replica holds every calendar's lock", async () => {
    await runTick("account-unauthorized");
    expect(accountNeedsReauthentication).toBe(true);

    await runTick("account-locked");

    expect(accountNeedsReauthentication).toBe(true);
  });

  it("clears the demand on a tick where a sibling authenticates and another replica holds the rejecting calendar's lock", async () => {
    await runTick("account-unauthorized");
    expect(accountNeedsReauthentication).toBe(true);

    await runTick("locked");

    expect(accountNeedsReauthentication).toBe(false);
  });
});
