import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SecretDecryptionError, createKeyring } from "@keeper.sh/database";
import {
  readCredentialAccessToken,
  readCredentialTokens,
  storeCredentialAccessToken,
  storeCredentialRefreshToken,
  storeRefreshedTokens,
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
  it("stores tokens as given without a key, and with encryption on write turned off", () => {
    for (const keyring of [
      createKeyring(),
      createKeyring({ encryptOnWrite: false, primaryKey: KEY }),
    ]) {
      const row = {
        accessToken: storeCredentialAccessToken(CREDENTIAL_ID, "new-access", keyring),
        oauthCredentialId: CREDENTIAL_ID,
        refreshToken: storeCredentialRefreshToken(CREDENTIAL_ID, "new-refresh", keyring),
      };

      expect(row.accessToken.stored).toBe("new-access");
      expect(row.refreshToken.stored).toBe("new-refresh");
    }
  });

  it("encrypts tokens whenever a key is set", () => {
    const keyring = createKeyring({ primaryKey: KEY });
    const row = {
      accessToken: storeCredentialAccessToken(CREDENTIAL_ID, "new-access", keyring),
      oauthCredentialId: CREDENTIAL_ID,
      refreshToken: storeCredentialRefreshToken(CREDENTIAL_ID, "new-refresh", keyring),
    };

    expect(row.accessToken.stored.startsWith("enc:v1:")).toBe(true);
    expect(row.refreshToken.stored.startsWith("enc:v1:")).toBe(true);
    expect(readCredentialTokens(row, keyring)).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
  });

  it("never serialises a stored token", () => {
    expect(JSON.stringify(plaintextRow())).not.toContain("plain-access");
    expect(JSON.stringify(plaintextRow())).not.toContain("plain-refresh");
  });
});

describe("storing refreshed tokens", () => {
  const encrypting = createKeyring({ primaryKey: KEY });

  it("writes nothing recognisable when a key is set", () => {
    const write = storeRefreshedTokens(
      CREDENTIAL_ID,
      { access_token: "fresh-access", refresh_token: "fresh-refresh" },
      "previous-refresh",
      encrypting,
    );
    const serialised = JSON.stringify({
      accessToken: write.accessToken.stored,
      refreshToken: write.refreshToken?.stored,
    });

    expect(serialised).not.toContain("fresh-access");
    expect(serialised).not.toContain("fresh-refresh");
    expect(readCredentialTokens(
      {
        accessToken: write.accessToken,
        oauthCredentialId: CREDENTIAL_ID,
        refreshToken: write.refreshToken ?? plaintextRow().refreshToken,
      },
      createKeyring({ primaryKey: KEY }),
    )).toEqual({ accessToken: "fresh-access", refreshToken: "fresh-refresh" });
  });

  it("omits the refresh token unless the provider issued a different one", () => {
    for (const grant of [
      { access_token: "fresh-access" },
      { access_token: "fresh-access", refresh_token: "previous-refresh" },
      { access_token: "fresh-access", refresh_token: "" },
    ]) {
      const write = storeRefreshedTokens(CREDENTIAL_ID, grant, "previous-refresh", encrypting);

      expect(Object.keys(write)).toEqual(["accessToken"]);
    }
  });
});
