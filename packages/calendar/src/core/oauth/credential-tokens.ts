import { TokenDecryptionError, decryptToken } from "@keeper.sh/database";
import type { StoredToken } from "@keeper.sh/database";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

interface StoredCredentialTokens {
  accessToken: StoredToken;
  refreshToken: StoredToken;
}

interface CredentialTokens {
  accessToken: string;
  refreshToken: string;
}

const readCredentialTokens = (
  stored: StoredCredentialTokens,
  encryptionKey: string | undefined,
): CredentialTokens => ({
  accessToken: decryptToken(stored.accessToken, encryptionKey),
  refreshToken: decryptToken(stored.refreshToken, encryptionKey),
});

const markCredentialNeedsReauthentication = async (
  database: BunSQLDatabase,
  calendarAccountId: string,
  error: unknown,
): Promise<void> => {
  if (!(error instanceof TokenDecryptionError) || !error.requiresReauthentication) {
    return;
  }

  await database
    .update(calendarAccountsTable)
    .set({ needsReauthentication: true })
    .where(eq(calendarAccountsTable.id, calendarAccountId));
};

const readCredentialTokensOrFlag = async (
  database: BunSQLDatabase,
  calendarAccountId: string,
  stored: StoredCredentialTokens,
  encryptionKey: string | undefined,
): Promise<CredentialTokens> => {
  try {
    return readCredentialTokens(stored, encryptionKey);
  } catch (error) {
    await markCredentialNeedsReauthentication(database, calendarAccountId, error);
    throw error;
  }
};

export {
  markCredentialNeedsReauthentication,
  readCredentialTokens,
  readCredentialTokensOrFlag,
};
export type { CredentialTokens, StoredCredentialTokens };
