import { calendarAccountsTable, oauthCredentialsTable } from "@keeper.sh/database/schema";
import { storeCredentialAccessToken, storeCredentialRefreshToken } from "@keeper.sh/calendar";
import { and, eq, notExists } from "drizzle-orm";
import { database, keyring } from "@/context";

const FIRST_RESULT_LIMIT = 1;

interface CreateOAuthSourceCredentialData {
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const createOAuthSourceCredential = async (
  userId: string,
  data: CreateOAuthSourceCredentialData,
): Promise<string> => {
  const [existing] = await database
    .select({ id: oauthCredentialsTable.id })
    .from(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.userId, userId),
        eq(oauthCredentialsTable.provider, data.provider),
        eq(oauthCredentialsTable.email, data.email ?? ""),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (existing) {
    await database
      .update(oauthCredentialsTable)
      .set({
        accessToken: storeCredentialAccessToken(existing.id, data.accessToken, keyring),
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: storeCredentialRefreshToken(existing.id, data.refreshToken, keyring),
      })
      .where(eq(oauthCredentialsTable.id, existing.id));

    return existing.id;
  }

  const credentialId = crypto.randomUUID();
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: storeCredentialAccessToken(credentialId, data.accessToken, keyring),
      email: data.email,
      expiresAt: data.expiresAt,
      id: credentialId,
      provider: data.provider,
      refreshToken: storeCredentialRefreshToken(credentialId, data.refreshToken, keyring),
      userId,
    })
    .returning({ id: oauthCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create OAuth source credential");
  }

  return credential.id;
};

const discardUnusedOAuthSourceCredential = async (credentialId: string): Promise<void> => {
  await database
    .delete(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        notExists(
          database
            .select({ id: calendarAccountsTable.id })
            .from(calendarAccountsTable)
            .where(eq(calendarAccountsTable.oauthCredentialId, credentialId)),
        ),
      ),
    );
};

export { createOAuthSourceCredential, discardUnusedOAuthSourceCredential };
