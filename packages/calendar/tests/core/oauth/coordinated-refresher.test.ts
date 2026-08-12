import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { TokenEncryptionError, decryptToken, isTokenEncrypted } from "@keeper.sh/database";
import type { StoredToken } from "@keeper.sh/database";
import { createCoordinatedRefresher } from "../../../src/core/oauth/coordinated-refresher";

const KEY = Buffer.from(new Uint8Array(32).fill(31)).toString("base64");
const NO_KEY = process.env.ENCRYPTION_KEY_DELIBERATELY_UNSET ?? "";

interface CapturedWrite {
  accessToken: StoredToken;
  refreshToken: StoredToken;
}

const createDatabase = (): {
  database: BunSQLDatabase;
  writes: CapturedWrite[];
} => {
  const writes: CapturedWrite[] = [];
  const database = {
    update: () => ({
      set: (values: Partial<CapturedWrite>) => ({
        where: () => {
          if (values.accessToken && values.refreshToken) {
            writes.push({ accessToken: values.accessToken, refreshToken: values.refreshToken });
          }
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as BunSQLDatabase;

  return { database, writes };
};

const createRefresher = (
  database: BunSQLDatabase,
  encryptionKey: string,
  response: { access_token: string; expires_in: number; refresh_token?: string },
) =>
  createCoordinatedRefresher({
    database,
    oauthCredentialId: "credential-1",
    calendarAccountId: "account-1",
    encryptionKey,
    refreshLockStore: null,
    rawRefresh: () => Promise.resolve(response),
  });

describe("OAuth refresh writes", () => {
  it("stores a refreshed access token encrypted", async () => {
    const { database, writes } = createDatabase();
    const refresh = createRefresher(database, KEY, {
      access_token: "fresh-access",
      expires_in: 3600,
      refresh_token: "fresh-refresh",
    });

    await refresh("old-refresh");

    expect(writes).toHaveLength(1);
    const [write] = writes;
    expect(isTokenEncrypted(write?.accessToken ?? ({} as StoredToken))).toBe(true);
    expect(isTokenEncrypted(write?.refreshToken ?? ({} as StoredToken))).toBe(true);
    expect(decryptToken(write?.accessToken ?? ({} as StoredToken), KEY)).toBe("fresh-access");
    expect(decryptToken(write?.refreshToken ?? ({} as StoredToken), KEY)).toBe("fresh-refresh");
  });

  it("encrypts the carried-over refresh token when the provider returns none", async () => {
    const { database, writes } = createDatabase();
    const refresh = createRefresher(database, KEY, {
      access_token: "fresh-access",
      expires_in: 3600,
    });

    await refresh("carried-over-refresh");

    expect(decryptToken(writes[0]?.refreshToken ?? ({} as StoredToken), KEY)).toBe(
      "carried-over-refresh",
    );
  });

  it("refuses to write a token when no encryption key is configured", async () => {
    const { database, writes } = createDatabase();
    const refresh = createRefresher(database, NO_KEY, {
      access_token: "fresh-access",
      expires_in: 3600,
    });

    await expect(refresh("old-refresh")).rejects.toThrow(TokenEncryptionError);
    expect(writes).toEqual([]);
  });
});
