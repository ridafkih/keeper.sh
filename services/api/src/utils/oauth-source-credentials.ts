import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

interface CreateOAuthSourceCredentialOptions {
  onCredentialCreated: (credentialId: string) => void;
}

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
  options: CreateOAuthSourceCredentialOptions,
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
        accessToken: data.accessToken,
        createdAt: new Date(),
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: data.refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, existing.id));

    return existing.id;
  }

  const [credential] = await database
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

  options.onCredentialCreated(credential.id);

  return credential.id;
};

const deleteOAuthSourceCredential = async (
  userId: string,
  credentialId: string,
): Promise<void> => {
  await database
    .delete(oauthCredentialsTable)
    .where(
      and(
        eq(oauthCredentialsTable.id, credentialId),
        eq(oauthCredentialsTable.userId, userId),
      ),
    );
};

export { createOAuthSourceCredential, deleteOAuthSourceCredential };
