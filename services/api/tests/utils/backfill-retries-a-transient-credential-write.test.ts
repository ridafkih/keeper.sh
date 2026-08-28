import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];
let credentialUpdateAttempts = 0;
let credentialUpdateFailures: unknown[] = [];

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
  const failure = credentialUpdateFailures.shift();

  if (failure !== undefined) {
    return Promise.reject(failure);
  }

  return Promise.resolve();
};

const updateForTable = (table: unknown) => ({
  set: (values: Record<string, unknown>) => ({
    where: () => applyUpdate(getTableName(table as never), values),
  }),
});

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
          refresh_token: "rotated-refresh-token",
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
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
  },
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
  credentialUpdateAttempts = 0;
  credentialUpdateFailures = [];
});

describe("the provider account id backfill credential write", () => {
  it("retries a transient failure instead of discarding the rotated refresh token", async () => {
    credentialUpdateFailures = [connectionTerminatedError()];
    const tally = emptyTally();

    await scriptModule.backfillRow(nearlyExpiredRow(), tally);

    expect(refreshCalls).toEqual(["stored-refresh-token"]);
    expect(credentialUpdateAttempts).toBeGreaterThan(1);

    const persisted = recordedUpdates.filter((update) => update.table === "oauth_credentials");
    expect(persisted.at(-1)?.values.refreshToken).toBe("rotated-refresh-token");
    expect(persisted.at(-1)?.values.accessToken).toBe("fresh-access-token");

    expect(tally.failed).toBe(0);
    expect(tally.updated).toBe(1);
  });

  it("fails on the first attempt when the credential write is not transient", async () => {
    credentialUpdateFailures = [new Error("null value in column violates not-null constraint")];
    const tally = emptyTally();

    await scriptModule.backfillRow(nearlyExpiredRow(), tally);

    expect(credentialUpdateAttempts).toBe(1);
    expect(tally.failed).toBe(1);
    expect(tally.updated).toBe(0);
  });
});
