import { encryptToken } from "@keeper.sh/database";
import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database, encryptionKey } from "@/context";

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
        accessToken: encryptToken(data.accessToken, encryptionKey),
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: encryptToken(data.refreshToken, encryptionKey),
      })
      .where(eq(oauthCredentialsTable.id, existing.id));

    return existing.id;
  }

  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: encryptToken(data.accessToken, encryptionKey),
      email: data.email,
      expiresAt: data.expiresAt,
      provider: data.provider,
      refreshToken: encryptToken(data.refreshToken, encryptionKey),
      userId,
    })
    .returning({ id: oauthCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create OAuth source credential");
  }

  return credential.id;
};

export { createOAuthSourceCredential };
