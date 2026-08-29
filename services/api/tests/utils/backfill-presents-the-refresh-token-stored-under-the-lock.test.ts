import { getTableName } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithCredentialRefreshLock as realRunWithCredentialRefreshLock }
  from "../../../../packages/calendar/src/core/oauth/refresh-coordinator";

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
}

const SELECTED_REFRESH_TOKEN = "refresh-token-read-when-the-candidate-was-selected";
const STORED_REFRESH_TOKEN = "refresh-token-the-sync-engine-rotated-into-place";
const NEAR_EXPIRY_ACCESS_TOKEN = "near-expiry-access-token";
const NEAR_EXPIRY_MS = 30_000;

let recordedUpdates: RecordedUpdate[] = [];
let refreshCalls: string[] = [];

const rowsForSelectedFields = (fields: unknown): unknown[] => {
  const keys = Object.keys((fields ?? {}) as Record<string, unknown>);

  if (keys.includes("refreshToken") && !keys.includes("accessToken")) {
    return [{ refreshToken: STORED_REFRESH_TOKEN }];
  }

  if (keys.includes("accessToken")) {
    return [{
      accessToken: NEAR_EXPIRY_ACCESS_TOKEN,
      expiresAt: new Date(Date.now() + NEAR_EXPIRY_MS),
    }];
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

const rotatedGrantError = (): Error =>
  Object.assign(new Error("invalid_grant: token has been expired or revoked"), {
    oauthReauthRequired: true,
  });

vi.mock("@/context", () => ({
  database: {
    select: (fields: unknown) => createSelectBuilder(rowsForSelectedFields(fields)),
    update: updateForTable,
  },
  oauthProviders: {
    getProvider: () => ({
      fetchUserInfo: () => Promise.resolve({ email: "person@example.com", id: "google-sub-1" }),
      refreshAccessToken: (refreshToken: string) => {
        refreshCalls.push(refreshToken);

        if (refreshToken !== STORED_REFRESH_TOKEN) {
          return Promise.reject(rotatedGrantError());
        }

        return Promise.resolve({
          access_token: "freshly-refreshed-access-token",
          expires_in: 3600,
          refresh_token: STORED_REFRESH_TOKEN,
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

const rowWhoseRefreshTokenWasRotatedAfterSelection = (): BackfillRefreshRow => ({
  accessToken: "access-token-read-when-the-candidate-was-selected",
  accountNeedsReauthentication: false,
  accountRowId: "calendar-account-1",
  credentialNeedsReauthentication: false,
  email: "person@example.com",
  expiresAt: new Date(Date.now() - 1000),
  oauthCredentialId: `credential-${crypto.randomUUID()}`,
  provider: "google",
  refreshToken: SELECTED_REFRESH_TOKEN,
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
});

describe("the provider account id backfill refreshes with the token stored under the lock", () => {
  it("presents the refresh token the credential row holds, not the one selection captured", async () => {
    await resolveAccessTokenUnderTest(rowWhoseRefreshTokenWasRotatedAfterSelection())
      .catch(() => null);

    expect(refreshCalls).toEqual([STORED_REFRESH_TOKEN]);
  });

  it("leaves a live calendar account unflagged when the token it captured was superseded", async () => {
    await resolveAccessTokenUnderTest(rowWhoseRefreshTokenWasRotatedAfterSelection())
      .catch(() => null);

    const reauthenticationFlags = recordedUpdates.filter(
      (update) =>
        update.table === "calendar_accounts"
        && update.values.needsReauthentication === true,
    );

    expect(reauthenticationFlags).toEqual([]);
  });
});
