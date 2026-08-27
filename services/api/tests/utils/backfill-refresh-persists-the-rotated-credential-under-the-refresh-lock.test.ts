import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];
let lockedCredentialIds: string[] = [];
let refreshRanUnderLock: boolean[] = [];
let lockDepth = 0;
let rotatedRefreshToken: string | undefined = "rotated-refresh-token";

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
    select: () => createSelectBuilder(),
    update: updateForTable,
  },
  oauthProviders: {
    getProvider: () => ({
      fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "ms-oid-x" }),
      refreshAccessToken: (refreshToken: string) => {
        refreshCalls.push(refreshToken);
        refreshRanUnderLock.push(lockDepth > 0);
        return Promise.resolve({
          access_token: "fresh-access-token",
          expires_in: 3600,
          refresh_token: rotatedRefreshToken,
        });
      },
    }),
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
  runWithCredentialRefreshLock: async (
    oauthCredentialId: string,
    runRefresh: () => Promise<unknown>,
  ) => {
    lockedCredentialIds.push(oauthCredentialId);
    lockDepth += 1;
    try {
      return await runRefresh();
    } finally {
      lockDepth -= 1;
    }
  },
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
  lockedCredentialIds = [];
  refreshRanUnderLock = [];
  lockDepth = 0;
  rotatedRefreshToken = "rotated-refresh-token";
});

describe("the provider account id backfill refresh", () => {
  it("persists the rotated refresh token and the new expiry to oauth_credentials", async () => {
    const before = Date.now();

    const accessToken = await resolveAccessTokenUnderTest(nearlyExpiredRow());

    expect(accessToken).toBe("fresh-access-token");
    expect(refreshCalls).toEqual(["stored-refresh-token"]);

    const credentialUpdates = recordedUpdates.filter(
      (update) => update.table === "oauth_credentials",
    );

    expect(credentialUpdates).toHaveLength(1);
    expect(credentialUpdates[0]?.values.accessToken).toBe("fresh-access-token");
    expect(credentialUpdates[0]?.values.refreshToken).toBe("rotated-refresh-token");

    const expiresAt = credentialUpdates[0]?.values.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3_600_000 - 5000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5000);
  });

  it("runs the backfill refresh inside the credential refresh lock", async () => {
    await resolveAccessTokenUnderTest(nearlyExpiredRow());

    expect(lockedCredentialIds).toEqual(["credential-1"]);
    expect(refreshRanUnderLock).toEqual([true]);
  });

  it("keeps the stored refresh token when the provider rotates nothing", async () => {
    rotatedRefreshToken = globalThis.undefined;

    await resolveAccessTokenUnderTest(nearlyExpiredRow());

    const credentialUpdates = recordedUpdates.filter(
      (update) => update.table === "oauth_credentials",
    );

    expect(credentialUpdates).toHaveLength(1);
    expect(credentialUpdates[0]?.values.refreshToken).toBe("stored-refresh-token");
  });
});
