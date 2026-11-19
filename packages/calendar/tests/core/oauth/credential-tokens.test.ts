import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretDecryptionError, createKeyring } from "@keeper.sh/database";
import {
  readCredentialAccessToken,
  readCredentialTokens,
  storeCredentialAccessToken,
  storeCredentialRefreshToken,
} from "../../../src/core/oauth/credential-tokens";

const CREDENTIAL_ID = "3a1c2b6e-8f41-4c5d-9e77-2b1f0c9d4e55";
const OTHER_CREDENTIAL_ID = "9d2e7c10-51a3-4b8f-a6c4-7e0f3b2a1d99";
const KEY = randomBytes(32).toString("base64");

const plaintextRow = () => ({
  accessToken: storeCredentialAccessToken(CREDENTIAL_ID, "plain-access", createKeyring()),
  oauthCredentialId: CREDENTIAL_ID,
  refreshToken: storeCredentialRefreshToken(CREDENTIAL_ID, "plain-refresh", createKeyring()),
});

const encryptedRow = () => {
  const keyring = createKeyring({ encryptOnWrite: true, primaryKey: KEY });
  return {
    accessToken: storeCredentialAccessToken(CREDENTIAL_ID, "sealed-access", keyring),
    oauthCredentialId: CREDENTIAL_ID,
    refreshToken: storeCredentialRefreshToken(CREDENTIAL_ID, "sealed-refresh", keyring),
  };
};

describe("reading stored credential tokens", () => {
  it("returns plaintext tokens unchanged with and without a key", () => {
    for (const keyring of [createKeyring(), createKeyring({ primaryKey: KEY })]) {
      expect(readCredentialTokens(plaintextRow(), keyring)).toEqual({
        accessToken: "plain-access",
        refreshToken: "plain-refresh",
      });
    }
  });

  it("decrypts encrypted tokens for the credential they belong to", () => {
    const keyring = createKeyring({ primaryKey: KEY });

    expect(readCredentialTokens(encryptedRow(), keyring)).toEqual({
      accessToken: "sealed-access",
      refreshToken: "sealed-refresh",
    });
    expect(readCredentialAccessToken(encryptedRow(), keyring)).toBe("sealed-access");
  });

  it("reads a row that mixes an encrypted and a plaintext token", () => {
    const row = { ...encryptedRow(), refreshToken: plaintextRow().refreshToken };

    expect(readCredentialTokens(row, createKeyring({ primaryKey: KEY }))).toEqual({
      accessToken: "sealed-access",
      refreshToken: "plain-refresh",
    });
  });

  it("refuses encrypted tokens presented under another credential", () => {
    const row = { ...encryptedRow(), oauthCredentialId: OTHER_CREDENTIAL_ID };

    expect(() => readCredentialTokens(row, createKeyring({ primaryKey: KEY })))
      .toThrow(SecretDecryptionError);
  });

  it("refuses encrypted tokens when no key is configured", () => {
    expect(() => readCredentialTokens(encryptedRow(), createKeyring()))
      .toThrow(SecretDecryptionError);
  });
});

describe("storing credential tokens", () => {
  it("stores tokens as given while encryption on write is off", () => {
    for (const keyring of [createKeyring(), createKeyring({ primaryKey: KEY })]) {
      const row = {
        accessToken: storeCredentialAccessToken(CREDENTIAL_ID, "new-access", keyring),
        oauthCredentialId: CREDENTIAL_ID,
        refreshToken: storeCredentialRefreshToken(CREDENTIAL_ID, "new-refresh", keyring),
      };

      expect(row.accessToken.stored).toBe("new-access");
      expect(row.refreshToken.stored).toBe("new-refresh");
    }
  });

  it("never serialises a stored token", () => {
    expect(JSON.stringify(plaintextRow())).not.toContain("plain-access");
    expect(JSON.stringify(plaintextRow())).not.toContain("plain-refresh");
  });
});
