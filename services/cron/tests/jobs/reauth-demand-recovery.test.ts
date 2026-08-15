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

const DELETED_CALENDAR_ID = "calendar-deleted-share";
const PERSONAL_CALENDAR_ID = "calendar-personal";

const DELETED_CALENDAR = {
  ...baseSource,
  calendarId: DELETED_CALENDAR_ID,
  calendarUrl: "https://dav.example.com/shared/",
};

const PERSONAL_CALENDAR = {
  ...baseSource,
  calendarId: PERSONAL_CALENDAR_ID,
  calendarUrl: "https://dav.example.com/personal/",
};

const CALENDAR_IDS = [DELETED_CALENDAR_ID, PERSONAL_CALENDAR_ID];

interface BackoffRow {
  failureCount: number;
  nextAttemptAt: Date | null;
}

const backoff = new Map<string, BackoffRow>();

let passwordAccepted = false;
let deletedCalendarPresent = false;

const collectStrings = (value: unknown, found: Set<string>, seen: Set<unknown>): void => {
  if (typeof value === "string") {
    found.add(value);
    return;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectStrings(nested, found, seen);
  }
};

const findCalendarId = (calls: { args: unknown[] }[]): string | null => {
  const found = new Set<string>();
  collectStrings(calls.map(({ args }) => args), found, new Set());
  return CALENDAR_IDS.find((calendarId) => found.has(calendarId)) ?? null;
};

const resolveSelect = (
  projection: Record<string, unknown>,
  calls: { args: unknown[] }[],
): unknown[] => {
  const keys = new Set(Object.keys(projection));
  if (keys.has("oauthCredentialId")) {
    return [];
  }
  if (keys.has("encryptedPassword") && keys.has("calendarId")) {
    return [DELETED_CALENDAR, PERSONAL_CALENDAR];
  }
  if (keys.has("encryptedPassword")) {
    const calendarId = findCalendarId(calls);
    if (calendarId === DELETED_CALENDAR_ID) {
      return [DELETED_CALENDAR];
    }
    if (calendarId === PERSONAL_CALENDAR_ID) {
      return [PERSONAL_CALENDAR];
    }
    return [];
  }
  if (keys.has("failureCount") && keys.has("nextAttemptAt")) {
    const calendarId = findCalendarId(calls);
    if (!calendarId) {
      throw new Error("backoff select without a calendar id");
    }
    return [backoff.get(calendarId) ?? { failureCount: 0, nextAttemptAt: null }];
  }
  if (keys.has("syncFutureRange") && keys.has("syncHistoricRange")) {
    return [];
  }
  if (keys.has("treatFullDayTimedEventsAsAllDay")) {
    return [];
  }
  throw new Error(`unexpected select projection: ${[...keys].join(",")}`);
};

const createRecordingQuery = (resolve: (calls: { args: unknown[] }[]) => unknown): unknown => {
  const calls: { args: unknown[] }[] = [];
  const proxy: unknown = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => resolve(calls)).then(onFulfilled).catch(onRejected);
      }
      return (...args: unknown[]) => {
        calls.push({ args });
        return proxy;
      };
    },
  });
  return proxy;
};

const applyWrite = (values: Record<string, unknown>, calls: { args: unknown[] }[]): void => {
  if ("needsReauthentication" in values) {
    const next = values.needsReauthentication === true;
    if (next === accountNeedsReauthentication) {
      return;
    }
    accountNeedsReauthentication = next;
    flagWrites.push(next);
    return;
  }
  if (!("ingestFailureCount" in values)) {
    return;
  }
  const calendarId = findCalendarId(calls);
  if (!calendarId) {
    throw new Error("backoff write without a calendar id");
  }
  backoff.set(calendarId, {
    failureCount: Number(values.ingestFailureCount ?? 0),
    nextAttemptAt: (values.ingestNextAttemptAt as Date | null) ?? null,
  });
};

const createUpdateQuery = (): unknown => {
  const calls: { args: unknown[] }[] = [];
  let pending: Record<string, unknown> | null = null;
  const proxy: unknown = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (onFulfilled: (value: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              if (pending) {
                applyWrite(pending, calls);
              }
              return [];
            })
            .then(onFulfilled);
      }
      return (...args: unknown[]) => {
        calls.push({ args });
        if (property === "set") {
          pending = args[0] as Record<string, unknown>;
        }
        return proxy;
      };
    },
  });
  return proxy;
};

vi.mock("@/context", () => ({
  database: {
    select: (projection: Record<string, unknown>) =>
      createRecordingQuery((calls) => resolveSelect(projection, calls)),
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
  ingestSource: ({ calendarId }: { calendarId: string }) =>
    Promise.resolve().then(() => {
      if (!passwordAccepted) {
        throw Object.assign(new Error("CalDAV request failed"), { status: 401 });
      }
      if (calendarId === DELETED_CALENDAR_ID && !deletedCalendarPresent) {
        throw Object.assign(
          new Error("Collection query failed: 404 Not Found"),
          { status: 404 },
        );
      }
      return { eventsAdded: 1, eventsRemoved: 0 };
    }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = async (): Promise<void> => {
  emitted.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

const resetState = (): void => {
  emitted.length = 0;
  flagWrites.length = 0;
  current = { fields: {}, values: {} };
  accountNeedsReauthentication = false;
  backoff.clear();
  passwordAccepted = false;
  deletedCalendarPresent = true;
};

describe("clearing an account's re-authentication demand once the credentials work again", () => {
  beforeEach(resetState);

  it("clears the demand when every calendar of the account ingests successfully", async () => {
    await runTick();
    expect(accountNeedsReauthentication).toBe(true);

    passwordAccepted = true;
    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("clears the demand once a calendar of the account authenticates, even though a sibling calendar was deleted on the server", async () => {
    deletedCalendarPresent = false;
    await runTick();
    expect(accountNeedsReauthentication).toBe(true);

    passwordAccepted = true;
    await runTick();
    await runTick();
    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("does not leave the demand raised while the deleted sibling sits in ingest backoff", async () => {
    deletedCalendarPresent = false;
    await runTick();
    passwordAccepted = true;

    await runTick();
    const backedOff = backoff.get(DELETED_CALENDAR_ID);
    expect(backedOff?.nextAttemptAt).toBeInstanceOf(Date);

    await runTick();

    expect(accountNeedsReauthentication).toBe(false);
  });

  it("settles instead of rewriting the row once the account has recovered", async () => {
    await runTick();
    passwordAccepted = true;
    await runTick();
    flagWrites.length = 0;

    await runTick();
    await runTick();
    await runTick();

    expect(flagWrites).toEqual([]);
  });
});
