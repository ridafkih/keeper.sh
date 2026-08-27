import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCredentialRefreshLock as realRunWithCredentialRefreshLock }
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

const PEER_ACCESS_TOKEN = "peer-rotated-access-token";
const PEER_REFRESH_TOKEN = "peer-rotated-refresh-token";
const STALE_ACCESS_TOKEN = "stale-access-token";
const PEER_REMAINING_MS = 3_600_000;

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];
let userInfoTokens: string[] = [];
let lockAcquireAttempts: string[] = [];

const peerPersistedCredentialRow = () => ({
  accessToken: PEER_ACCESS_TOKEN,
  expiresAt: new Date(Date.now() + PEER_REMAINING_MS),
});

const rowsForSelectedFields = (fields: unknown): unknown[] => {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

  if (keys.includes("refreshToken")) {
    return [];
  }

  if (keys.includes("accessToken")) {
    return [peerPersistedCredentialRow()];
  }

  return [];
};

type SelectPromise = Promise<unknown[]> & {
  from: () => SelectPromise;
  innerJoin: () => SelectPromise;
  where: () => SelectPromise;
  limit: () => Promise<unknown[]>;
};

const createSelectBuilder = (result: unknown[]): SelectPromise => {
  const chain = Promise.resolve(result) as unknown as SelectPromise;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => Promise.resolve(result);
  return chain;
};

const updateForTable = (table: unknown) => ({
  set: (values: Record<string, unknown>) => {
    recordedUpdates.push({ table: getTableName(table as never), values });

    const chain = Promise.resolve() as Promise<void> & { where: () => Promise<void> };
    chain.where = () => Promise.resolve();

    return chain;
  },
});

vi.mock("@/context", () => ({
  database: {
    select: (fields: unknown) => createSelectBuilder(rowsForSelectedFields(fields)),
    update: updateForTable,
  },
  oauthProviders: {
    getProvider: () => ({
      fetchUserInfo: (accessToken: string) => {
        userInfoTokens.push(accessToken);
        return Promise.resolve({ email: "person@example.com", id: "ms-oid-x" });
      },
      refreshAccessToken: (refreshToken: string) => {
        refreshCalls.push(refreshToken);
        return Promise.resolve({
          access_token: "script-rotated-access-token",
          expires_in: 3600,
          refresh_token: "script-rotated-refresh-token",
        });
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

vi.mock("@keeper.sh/calendar", () => ({
  runWithCredentialRefreshLock: realRunWithCredentialRefreshLock,
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

const scriptModule = await import("../../src/scripts/backfill-provider-account-ids") as {
  resolveAccessToken?: (row: BackfillRefreshRow) => Promise<string>;
};

const nearlyExpiredRow = (): BackfillRefreshRow => ({
  accessToken: STALE_ACCESS_TOKEN,
  accountNeedsReauthentication: false,
  accountRowId: "account-1",
  credentialNeedsReauthentication: false,
  email: "person@example.com",
  expiresAt: new Date(Date.now() + 30_000),
  oauthCredentialId: `credential-${crypto.randomUUID()}`,
  provider: "outlook",
  refreshToken: PEER_REFRESH_TOKEN,
});

const resolveAccessTokenUnderTest = async (row: BackfillRefreshRow): Promise<string> => {
  const { resolveAccessToken } = scriptModule;
  expect(typeof resolveAccessToken).toBe("function");
  if (!resolveAccessToken) {
    throw new Error("the backfill script does not export resolveAccessToken");
  }
  return await resolveAccessToken(row);
};

beforeEach(() => {
  recordedUpdates = [];
  refreshCalls = [];
  userInfoTokens = [];
  lockAcquireAttempts = [];
});

describe("the provider account id backfill coordinates with the fleet", () => {
  it("does not call the provider refresh while a peer holds the credential refresh lock", async () => {
    await resolveAccessTokenUnderTest(nearlyExpiredRow());

    expect(lockAcquireAttempts).toHaveLength(1);
    expect(refreshCalls).toEqual([]);
  });

  it("adopts the access token the peer persisted", async () => {
    const accessToken = await resolveAccessTokenUnderTest(nearlyExpiredRow());

    expect(accessToken).toBe(PEER_ACCESS_TOKEN);
  });

  it("leaves the peer's refresh token in place", async () => {
    await resolveAccessTokenUnderTest(nearlyExpiredRow());

    const credentialUpdates = recordedUpdates.filter(
      (update) => update.table === "oauth_credentials",
    );

    expect(credentialUpdates).toEqual([]);
  });
});
