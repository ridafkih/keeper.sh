import { oauthSourceCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database } from "../context";

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
    .select({ id: oauthSourceCredentialsTable.id })
    .from(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.userId, userId),
        eq(oauthSourceCredentialsTable.provider, data.provider),
        eq(oauthSourceCredentialsTable.email, data.email ?? ""),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (existing) {
    await database
      .update(oauthSourceCredentialsTable)
      .set({
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: data.refreshToken,
      })
      .where(eq(oauthSourceCredentialsTable.id, existing.id));

    return existing.id;
  }

  const [credential] = await database
    .insert(oauthSourceCredentialsTable)
    .values({
      accessToken: data.accessToken,
      email: data.email,
      expiresAt: data.expiresAt,
      provider: data.provider,
      refreshToken: data.refreshToken,
      userId,
    })
    .returning({ id: oauthSourceCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create OAuth source credential");
  }

  return credential.id;
};


export {
  createOAuthSourceCredential,
};
