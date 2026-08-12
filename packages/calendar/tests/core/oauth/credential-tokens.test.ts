import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import {
  TokenDecryptionError,
  encryptToken,
  readStoredToken,
  storedTokenValue,
} from "@keeper.sh/database";
import {
  markCredentialNeedsReauthentication,
  readCredentialTokens,
} from "../../../src/core/oauth/credential-tokens";

const ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
const WRONG_KEY = Buffer.from(new Uint8Array(32).fill(6)).toString("base64");

const createRecordingDatabase = (): {
  database: BunSQLDatabase;
  updatedAccountIds: string[];
} => {
  const updatedAccountIds: string[] = [];
  const database = {
    update: () => ({
      set: (values: { needsReauthentication?: boolean }) => ({
        where: (condition: { accountId?: string }) => {
          if (values.needsReauthentication === true) {
            updatedAccountIds.push(condition.accountId ?? "unknown");
          }
          return Promise.resolve();
        },
      }),
    }),
  } as unknown as BunSQLDatabase;

  return { database, updatedAccountIds };
};

describe("readCredentialTokens", () => {
  it("decrypts an encrypted credential pair", () => {
    const tokens = readCredentialTokens(
      {
        accessToken: encryptToken("access-1", ENCRYPTION_KEY),
        refreshToken: encryptToken("refresh-1", ENCRYPTION_KEY),
      },
      ENCRYPTION_KEY,
    );

    expect(tokens).toEqual({ accessToken: "access-1", refreshToken: "refresh-1" });
  });

  it("reads an unmigrated plaintext credential pair", () => {
    const tokens = readCredentialTokens(
      {
        accessToken: readStoredToken("plain-access"),
        refreshToken: readStoredToken("plain-refresh"),
      },
      ENCRYPTION_KEY,
    );

    expect(tokens).toEqual({ accessToken: "plain-access", refreshToken: "plain-refresh" });
  });

  it("reads a half-migrated credential where only the access token is encrypted", () => {
    const tokens = readCredentialTokens(
      {
        accessToken: encryptToken("access-2", ENCRYPTION_KEY),
        refreshToken: readStoredToken("plain-refresh-2"),
      },
      ENCRYPTION_KEY,
    );

    expect(tokens).toEqual({ accessToken: "access-2", refreshToken: "plain-refresh-2" });
  });

  it("throws rather than returning a partial pair when one token is unreadable", () => {
    const encrypted = readStoredToken(storedTokenValue(encryptToken("access-3", ENCRYPTION_KEY)));

    expect(() =>
      readCredentialTokens(
        { accessToken: encrypted, refreshToken: readStoredToken("plain") },
        WRONG_KEY,
      ),
    ).toThrow(TokenDecryptionError);
  });
});

describe("markCredentialNeedsReauthentication", () => {
  it("marks the account when the stored token is unreadable", async () => {
    const { database, updatedAccountIds } = createRecordingDatabase();

    await markCredentialNeedsReauthentication(
      database,
      "account-1",
      new TokenDecryptionError("unreadable", "boom"),
    );

    expect(updatedAccountIds).toEqual(["unknown"]);
  });

  it("does not mark the account when the encryption key is merely absent", async () => {
    const { database, updatedAccountIds } = createRecordingDatabase();

    await markCredentialNeedsReauthentication(
      database,
      "account-1",
      new TokenDecryptionError("missing-key", "boom"),
    );

    expect(updatedAccountIds).toEqual([]);
  });

  it("does not mark the account for unrelated failures", async () => {
    const { database, updatedAccountIds } = createRecordingDatabase();

    await markCredentialNeedsReauthentication(database, "account-1", new Error("network"));

    expect(updatedAccountIds).toEqual([]);
  });
});
