import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  TokenDecryptionError,
  encryptToken,
  readStoredToken,
  storedTokenValue,
} from "@keeper.sh/database";
import type { StoredToken } from "@keeper.sh/database";

const capturedGoogleConfigs: { accessToken: string; refreshToken: string }[] = [];

vi.mock("@keeper.sh/calendar/google", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  createGoogleSyncProvider: (config: { accessToken: string; refreshToken: string }) => {
    capturedGoogleConfigs.push({
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
    });
    return { listRemoteEvents: () => Promise.resolve([]) };
  },
}));

const { resolveSyncProvider } = await import("../src/resolve-provider");

const KEY = Buffer.from(new Uint8Array(32).fill(21)).toString("base64");
const WRONG_KEY = Buffer.from(new Uint8Array(32).fill(22)).toString("base64");

const OAUTH_CONFIG = {
  googleClientId: "client-id",
  googleClientSecret: "client-secret",
};

const createDatabase = (
  credential: { accessToken: StoredToken; refreshToken: StoredToken },
): { database: BunSQLDatabase; reauthenticatedAccountIds: string[] } => {
  const reauthenticatedAccountIds: string[] = [];

  const selectBuilder = {
    from: () => selectBuilder,
    innerJoin: () => selectBuilder,
    where: () => selectBuilder,
    limit: () =>
      Promise.resolve([
        {
          accessToken: credential.accessToken,
          refreshToken: credential.refreshToken,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          externalCalendarId: "external-calendar",
          oauthCredentialId: "credential-1",
        },
      ]),
  };

  const database = {
    select: () => selectBuilder,
    update: () => ({
      set: (values: { needsReauthentication?: boolean }) => ({
        where: () => {
          if (values.needsReauthentication === true) {
            reauthenticatedAccountIds.push("marked");
          }
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as BunSQLDatabase;

  return { database, reauthenticatedAccountIds };
};

const resolve = (database: BunSQLDatabase, encryptionKey: string) =>
  resolveSyncProvider({
    database,
    provider: "google",
    calendarId: "calendar-1",
    userId: "user-1",
    accountId: "account-1",
    oauthConfig: OAUTH_CONFIG,
    encryptionKey,
  });

beforeEach(() => {
  capturedGoogleConfigs.length = 0;
});

describe("sync path token reads", () => {
  it("hands the provider the decrypted token for an encrypted credential", async () => {
    const { database } = createDatabase({
      accessToken: readStoredToken(storedTokenValue(encryptToken("live-access", KEY))),
      refreshToken: readStoredToken(storedTokenValue(encryptToken("live-refresh", KEY))),
    });

    const provider = await resolve(database, KEY);

    expect(provider).not.toBeNull();
    expect(capturedGoogleConfigs).toEqual([
      { accessToken: "live-access", refreshToken: "live-refresh" },
    ]);
  });

  it("hands the provider the raw token for an unmigrated plaintext credential", async () => {
    const { database } = createDatabase({
      accessToken: readStoredToken("legacy-access"),
      refreshToken: readStoredToken("legacy-refresh"),
    });

    const provider = await resolve(database, KEY);

    expect(provider).not.toBeNull();
    expect(capturedGoogleConfigs).toEqual([
      { accessToken: "legacy-access", refreshToken: "legacy-refresh" },
    ]);
  });

  it("fails loudly and flags the account when the stored token cannot be decrypted", async () => {
    const { database, reauthenticatedAccountIds } = createDatabase({
      accessToken: readStoredToken(storedTokenValue(encryptToken("live-access", KEY))),
      refreshToken: readStoredToken(storedTokenValue(encryptToken("live-refresh", KEY))),
    });

    await expect(resolve(database, WRONG_KEY)).rejects.toThrow(TokenDecryptionError);

    expect(capturedGoogleConfigs).toEqual([]);
    expect(reauthenticatedAccountIds).toEqual(["marked"]);
  });
});
