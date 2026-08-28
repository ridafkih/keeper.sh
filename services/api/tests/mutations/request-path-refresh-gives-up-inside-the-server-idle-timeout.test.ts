import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { SERVER_IDLE_TIMEOUT_SECONDS } from "@keeper.sh/constants";
import { createCoordinatedRefresher as realCreateCoordinatedRefresher }
  from "../../../../packages/calendar/src/core/oauth/coordinated-refresher";

let lockAcquireAttempts: string[] = [];
let refreshedWithTokens: string[] = [];
let providerDialAttempts: string[] = [];

const MS_PER_SECOND = 1000;
const IDLE_TIMEOUT_WALL_MS = SERVER_IDLE_TIMEOUT_SECONDS * MS_PER_SECOND;
const CASE_TIMEOUT_MS = 120_000;
const REFRESH_WINDOW_MARGIN_MS = 5000;

const CREDENTIAL_ID = "credential-1";
const STORED_ACCESS_TOKEN = "mutation-path-access-token";
const STORED_REFRESH_TOKEN = "mutation-path-refresh-token";

const credentialJoinRow = () => ({
  accountId: "account-1",
  caldavAuthMethod: null,
  caldavEncryptedPassword: null,
  caldavServerUrl: null,
  caldavUsername: null,
  calendarId: "calendar-1",
  calendarUrl: null,
  email: "person@example.com",
  externalCalendarId: "primary",
  needsReauthentication: false,
  oauthAccessToken: STORED_ACCESS_TOKEN,
  oauthCredentialId: CREDENTIAL_ID,
  oauthExpiresAt: new Date(Date.now() + REFRESH_WINDOW_MARGIN_MS),
  oauthRefreshToken: STORED_REFRESH_TOKEN,
  provider: "google",
});

const staleCredentialRow = () => ({
  accessToken: STORED_ACCESS_TOKEN,
  expiresAt: new Date(Date.now() + REFRESH_WINDOW_MARGIN_MS),
});

const rowsForSelectedFields = (fields: unknown): unknown[] => {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

  if (keys.includes("oauthCredentialId")) {
    return [credentialJoinRow()];
  }

  if (keys.includes("accessToken")) {
    return [staleCredentialRow()];
  }

  return [];
};

type SelectPromise = Promise<unknown[]> & {
  from: () => SelectPromise;
  innerJoin: () => SelectPromise;
  leftJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const createSelectBuilder = (result: unknown[]): SelectPromise => {
  const chain = Promise.resolve(result) as SelectPromise;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(result);
  return chain;
};

const insertForTable = (table: unknown) => ({
  values: () => {
    const chain = Promise.resolve() as Promise<void> & {
      returning: () => Promise<unknown>;
    };
    chain.returning = () =>
      Promise.reject(new Error(`no row should be written to ${getTableName(table as never)}`));

    return chain;
  },
});

const updateForTable = () => ({
  set: () => {
    const chain = Promise.resolve() as Promise<void> & { where: () => Promise<void> };
    chain.where = () => Promise.resolve();
    return chain;
  },
});

const database = {
  insert: insertForTable,
  select: (fields: unknown) => createSelectBuilder(rowsForSelectedFields(fields)),
  transaction: (callback: (tx: object) => Promise<unknown>) => callback(database),
  update: updateForTable,
};

vi.mock("../../src/env", () => ({
  default: {},
  schema: {},
}));

vi.mock("@keeper.sh/calendar", () => ({
  createCoordinatedRefresher: realCreateCoordinatedRefresher,
}));

vi.mock("../../src/mutations/providers/google", () => ({
  createGoogleEvent: (accessToken: string) => {
    providerDialAttempts.push(accessToken);
    return Promise.reject(new Error("the provider must not be dialled without a fresh token"));
  },
  deleteGoogleEvent: () => Promise.reject(new Error("not used")),
  getPendingGoogleInvites: () => Promise.reject(new Error("not used")),
  rsvpGoogleEvent: () => Promise.reject(new Error("not used")),
  updateGoogleEvent: () => Promise.reject(new Error("not used")),
}));

vi.mock("../../src/mutations/providers/outlook", () => ({
  createOutlookEvent: () => Promise.reject(new Error("not used")),
  deleteOutlookEvent: () => Promise.reject(new Error("not used")),
  getPendingOutlookInvites: () => Promise.reject(new Error("not used")),
  rsvpOutlookEvent: () => Promise.reject(new Error("not used")),
  updateOutlookEvent: () => Promise.reject(new Error("not used")),
}));

vi.mock("../../src/mutations/providers/caldav", () => ({
  createCalDAVEvent: () => Promise.reject(new Error("not used")),
  deleteCalDAVEvent: () => Promise.reject(new Error("not used")),
  getPendingCalDAVInvites: () => Promise.reject(new Error("not used")),
  rsvpCalDAVEvent: () => Promise.reject(new Error("not used")),
  updateCalDAVEvent: () => Promise.reject(new Error("not used")),
}));

vi.mock("../../src/queries/get-event", () => ({
  getEvent: () => Promise.reject(new Error("no event should be read back")),
}));

afterAll(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  lockAcquireAttempts = [];
  refreshedWithTokens = [];
  providerDialAttempts = [];
});

const dependencies = () => ({
  database: database as never,
  encryptionKey: "encryption-key",
  oauthTokenRefresher: {
    getProvider: () => ({
      refreshAccessToken: (refreshToken: string) => {
        refreshedWithTokens.push(refreshToken);
        return Promise.resolve({ access_token: "rotated", expires_in: 3600 });
      },
    }),
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: (key: string) => {
      lockAcquireAttempts.push(key);
      return Promise.resolve(false);
    },
  },
});

const eventInput = () => ({
  calendarId: "calendar-1",
  endTime: new Date(Date.now() + 3_600_000).toISOString(),
  startTime: new Date().toISOString(),
  title: "Contended refresh",
});

describe("Request path refresh gives up inside the server idle timeout", () => {
  it("settles the mutation before the socket idle timeout while the lock stays held", async () => {
    const { createEventMutation } = await import("../../src/mutations/index");
    const startedAt = Date.now();

    const settled: unknown = await createEventMutation(
      dependencies(),
      "user-1",
      eventInput() as never,
    ).then((result: unknown) => result, (error: unknown) => error);

    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(IDLE_TIMEOUT_WALL_MS);
    expect(settled).toBeInstanceOf(Error);
    expect((settled as Error).message).toContain("already in progress on another instance");
    expect(lockAcquireAttempts.length).toBeGreaterThan(1);
    expect(refreshedWithTokens).toEqual([]);
    expect(providerDialAttempts).toEqual([]);
  }, CASE_TIMEOUT_MS);

  it("keeps the mutation acquire budget below the server idle timeout", async () => {
    const mutations = await import("../../src/mutations/index") as Record<string, unknown>;
    const budgetMs = mutations.MUTATION_REFRESH_ACQUIRE_BUDGET_MS;

    expect(typeof budgetMs).toBe("number");
    expect(budgetMs as number).toBeLessThan(IDLE_TIMEOUT_WALL_MS);
  });
});
