import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq, sql } from "drizzle-orm";
import { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;
const USER_ACCOUNT_LOCK_NAMESPACE = 9002;

interface CreateOAuthSourceCredentialData {
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// Two connects of one account can overlap, so the lookup and insert hold the user's account lock.
const createOAuthSourceCredential = (
  userId: string,
  data: CreateOAuthSourceCredentialData,
): Promise<string> => database.transaction(async (client) => {
  await client.execute(sql`select pg_advisory_xact_lock(${USER_ACCOUNT_LOCK_NAMESPACE}, hashtext(${userId}))`);
  const [existing] = await client
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
    await client
      .update(oauthCredentialsTable)
      .set({
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: data.refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, existing.id));

    return existing.id;
  }

  const [credential] = await client
    .insert(oauthCredentialsTable)
    .values({
      accessToken: data.accessToken,
      email: data.email,
      expiresAt: data.expiresAt,
      provider: data.provider,
      refreshToken: data.refreshToken,
      userId,
    })
    .returning({ id: oauthCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create OAuth source credential");
  }

  return credential.id;
});

export { createOAuthSourceCredential };
