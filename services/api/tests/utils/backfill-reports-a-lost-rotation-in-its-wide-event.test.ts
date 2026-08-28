import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];
let widelogFields: Array<[string, unknown]> = [];
let credentialUpdateAttempts = 0;
let rotatedRefreshToken: string | undefined = "rotated-refresh-token";

const connectionTerminatedError = () =>
  Object.assign(new Error("connection terminated unexpectedly"), {
    code: "ERR_POSTGRES_EXPECTED_REQUEST",
  });

type SelectPromise = Promise<unknown[]> & {
  from: () => SelectPromise;
  innerJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const createSelectBuilder = (): SelectPromise => {
  const chain = Promise.resolve([]) as unknown as SelectPromise;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve([]);
  return chain;
};

const applyUpdate = (table: string, values: Record<string, unknown>): Promise<void> => {
  recordedUpdates.push({ table, values });

  if (table !== "oauth_credentials") {
    return Promise.resolve();
  }

  credentialUpdateAttempts += 1;

  return Promise.reject(connectionTerminatedError());
};

const updateForTable = (table: unknown) => ({
  set: (values: Record<string, unknown>) => ({
    where: () => applyUpdate(getTableName(table as never), values),
  }),
});

const capturingWidelog = () => ({
  error: () => null,
  errorFields: () => null,
  flush: () => null,
  set: (field: string, value: unknown) => {
    widelogFields.push([field, value]);
  },
});

vi.mock("widelogger", () => ({
  widelog: capturingWidelog(),
  widelogger: () => ({
    context: (callback: () => Promise<void>) => callback(),
    destroy: () => Promise.resolve(),
  }),
}));

vi.mock("@/context", () => ({
  database: {
    select: () => createSelectBuilder(),
    update: updateForTable,
  },
  oauthProviders: {
    getProvider: () => ({
      fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "ms-oid-x" }),
      refreshAccessToken: (refreshToken: string) => {
        refreshCalls.push(refreshToken);
        return Promise.resolve({
          access_token: "fresh-access-token",
          expires_in: 3600,
          refresh_token: rotatedRefreshToken,
        });
      },
    }),
  },
  refreshLockStore: {
    release: () => Promise.resolve(),
    tryAcquire: () => Promise.resolve(true),
  },
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => Promise<void>) => callback(),
  destroy: () => Promise.resolve(),
  widelog: capturingWidelog(),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runWithCredentialRefreshLock: (
    _oauthCredentialId: string,
    runRefresh: () => Promise<unknown>,
  ) => runRefresh(),
}));

vi.mock("@keeper.sh/database/provider-account-identity", () => ({
  reconcileProviderAccountIdentity: () => Promise.resolve("adopted"),
}));

interface BackfillRefreshRow {
  accessToken: string;
  accountNeedsReauthentication: boolean;
  accountRowId: string;
  credentialNeedsReauthentication: boolean;
  email: string | null;
  expiresAt: Date;
  oauthCredentialId: string;
  provider: string;
  refreshToken: string;
}

interface BackfillTally {
  failed: number;
  skippedReauth: number;
  updated: number;
}

const scriptModule = await import("../../src/scripts/backfill-provider-account-ids") as {
  backfillRow: (row: BackfillRefreshRow, tally: BackfillTally) => Promise<void>;
};

const nearlyExpiredRow = (): BackfillRefreshRow => ({
  accessToken: "stale-access-token",
  accountNeedsReauthentication: false,
  accountRowId: "account-1",
  credentialNeedsReauthentication: false,
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  oauthCredentialId: "credential-1",
  provider: "outlook",
  refreshToken: "stored-refresh-token",
});

const emptyTally = (): BackfillTally => ({ failed: 0, skippedReauth: 0, updated: 0 });

beforeEach(() => {
  recordedUpdates = [];
  refreshCalls = [];
  widelogFields = [];
  credentialUpdateAttempts = 0;
  rotatedRefreshToken = "rotated-refresh-token";
});

describe("the provider account id backfill wide event", () => {
  it("reports a lost rotation instead of an indistinguishable failure", async () => {
    const tally = emptyTally();

    await scriptModule.backfillRow(nearlyExpiredRow(), tally);

    expect(refreshCalls).toEqual(["stored-refresh-token"]);
    expect(credentialUpdateAttempts).toBeGreaterThan(1);
    expect(recordedUpdates.at(-1)?.values.refreshToken).toBe("rotated-refresh-token");

    expect(widelogFields).toContainEqual(["token.rotation_lost", true]);
    expect(tally.failed).toBe(1);
    expect(tally.updated).toBe(0);
  });

  it("reports no lost rotation when the provider returned no new refresh token", async () => {
    rotatedRefreshToken = undefined;
    const tally = emptyTally();

    await scriptModule.backfillRow(nearlyExpiredRow(), tally);

    expect(widelogFields).toContainEqual(["token.rotation_lost", false]);
    expect(tally.failed).toBe(1);
  });
});
