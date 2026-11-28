import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { openSecret, sealSecret } from "@keeper.sh/database";
import type { Keyring } from "@keeper.sh/database";
import type { oauthCredentialsTable as OAuthCredentialsTable } from "@keeper.sh/database/schema";

const encryptStoredOAuthCredential = async (
  database: BunSQLDatabase,
  oauthCredentialsTable: typeof OAuthCredentialsTable,
  credentialId: string,
  keyring: Keyring,
): Promise<void> => {
  const [row] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(oauthCredentialsTable)
    .where(eq(oauthCredentialsTable.id, credentialId))
    .limit(1);
  if (!row) {
    throw new Error(`credential ${credentialId} not found`);
  }

  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: sealSecret(
        "oauth_credentials.accessToken",
        openSecret(row.accessToken, keyring, credentialId),
        keyring,
        credentialId,
      ),
      refreshToken: sealSecret(
        "oauth_credentials.refreshToken",
        openSecret(row.refreshToken, keyring, credentialId),
        keyring,
        credentialId,
      ),
    })
    .where(eq(oauthCredentialsTable.id, credentialId));
};

export { encryptStoredOAuthCredential };
