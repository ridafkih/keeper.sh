import { openSecret, sealSecret } from "@keeper.sh/database";
import type { Keyring, StoredSecret } from "@keeper.sh/database";

type StoredAccessToken = StoredSecret<"oauth_credentials.accessToken">;
type StoredRefreshToken = StoredSecret<"oauth_credentials.refreshToken">;

interface StoredCredentialTokens {
  oauthCredentialId: string;
  accessToken: StoredAccessToken;
  refreshToken: StoredRefreshToken;
}

interface CredentialTokens {
  accessToken: string;
  refreshToken: string;
}

const readCredentialAccessToken = (
  stored: Pick<StoredCredentialTokens, "oauthCredentialId" | "accessToken">,
  keyring: Keyring,
): string => openSecret(stored.accessToken, keyring, stored.oauthCredentialId);

const readCredentialTokens = (
  stored: StoredCredentialTokens,
  keyring: Keyring,
): CredentialTokens => ({
  accessToken: readCredentialAccessToken(stored, keyring),
  refreshToken: openSecret(stored.refreshToken, keyring, stored.oauthCredentialId),
});

const storeCredentialAccessToken = (
  oauthCredentialId: string,
  accessToken: string,
  keyring: Keyring,
): StoredAccessToken =>
  sealSecret("oauth_credentials.accessToken", accessToken, keyring, oauthCredentialId);

const storeCredentialRefreshToken = (
  oauthCredentialId: string,
  refreshToken: string,
  keyring: Keyring,
): StoredRefreshToken =>
  sealSecret("oauth_credentials.refreshToken", refreshToken, keyring, oauthCredentialId);

export {
  readCredentialAccessToken,
  readCredentialTokens,
  storeCredentialAccessToken,
  storeCredentialRefreshToken,
};
export type {
  CredentialTokens,
  StoredAccessToken,
  StoredCredentialTokens,
  StoredRefreshToken,
};
