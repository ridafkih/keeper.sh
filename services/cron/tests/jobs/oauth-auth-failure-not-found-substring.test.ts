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
  accessToken: "access-token",
  accountId: "account-1",
  expiresAt: new Date(Date.now() + 3_600_000),
  ingestFutureRange: "P90D",
  ingestHistoricRange: "P30D",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: null,
  ingestWindowStart: null,
  oauthCredentialId: "credential-1",
  provider: "outlook",
  refreshToken: "refresh-token",
  syncToken: null,
  userId: "user-1",
};

const REVOKED_CALENDAR = {
  ...baseSource,
  calendarId: "calendar-revoked",
  externalCalendarId: "AAMkAGI2TG93AAA=",
};

const SECOND_CALENDAR = {
  ...baseSource,
  calendarId: "calendar-second",
  externalCalendarId: "AAMkAGI2TG94AAA=",
};

const buildGraphUnauthorizedBody = (requestId: string): string => JSON.stringify({
  error: {
    code: "InvalidAuthenticationToken",
    innerError: {
      "client-request-id": "5b1e9a70-3f22-4c9d-8a11-6c3ea72b0d4e",
      date: "2026-08-13T05:12:31",
      "request-id": requestId,
    },
    message: "Access token has expired or is not yet valid.",
  },
});

const REQUEST_ID_WITH_NOT_FOUND_SUBSTRING = "9f1c404a-2b7d-49e6-9a51-1d0c8f3b7e22";
const REQUEST_ID_WITHOUT_NOT_FOUND_SUBSTRING = "9f1c8e5a-2b7d-49e6-9a51-1d0c8f3b7e22";

let requestId = REQUEST_ID_WITH_NOT_FOUND_SUBSTRING;

const createAuthFailure = (): Error =>
  Object.assign(
    new Error(`Failed to fetch events: 401: ${buildGraphUnauthorizedBody(requestId)}`),
    { authRequired: true, status: 401 },
  );

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
  if (keys.has("oauthCredentialId") && keys.has("calendarId")) {
    return [REVOKED_CALENDAR, SECOND_CALENDAR];
  }
  if (keys.has("oauthCredentialId")) {
    return [REVOKED_CALENDAR];
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

const UPDATED_ROW_ID = "0f6f1f3a-9c1a-4a6f-9a0e-2a5c7b1d4e83";

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
              return [{ id: UPDATED_ROW_ID }];
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

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  ingestSource: () => Promise.resolve().then(() => {
    throw createAuthFailure();
  }),
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const runTick = async (): Promise<void> => {
  emitted.length = 0;
  await Promise.resolve(ingestSourcesJob.callback()).catch(() => null);
};

describe("an Outlook token revocation whose error body carries a request id containing 404", () => {
  beforeEach(() => {
    emitted.length = 0;
    flagWrites.length = 0;
    current = { fields: {}, values: {} };
    accountNeedsReauthentication = false;
    requestId = REQUEST_ID_WITH_NOT_FOUND_SUBSTRING;
  });

  it("is classified correctly when the very same failure carries a request id without that substring", async () => {
    requestId = REQUEST_ID_WITHOUT_NOT_FOUND_SUBSTRING;

    await runTick();

    expect(emitted.map(({ fields }) => fields.slug)).toContain("provider-auth-failed");
    expect(accountNeedsReauthentication).toBe(true);
  });

  it("reports the revoked calendar as an authentication failure, not a missing calendar", async () => {
    await runTick();

    const slugs = emitted.map(({ fields }) => fields.slug);

    expect(slugs).toContain("provider-auth-failed");
    expect(slugs).not.toContain("provider-calendar-not-found");
  });

  it("marks the failure as needing re-authentication", async () => {
    await runTick();

    expect(
      emitted.some(({ fields }) => fields.requiresReauth === true),
    ).toBe(true);
  });

  it("raises the account's re-authentication demand", async () => {
    await runTick();

    expect(accountNeedsReauthentication).toBe(true);
  });

  it("converges instead of flipping the demand on every tick", async () => {
    await runTick();
    await runTick();
    await runTick();

    expect(flagWrites).toEqual([true]);
  });
});
