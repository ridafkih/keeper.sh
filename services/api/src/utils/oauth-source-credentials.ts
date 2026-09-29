import { oauthCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { database } from "@/context";

const FIRST_RESULT_LIMIT = 1;

interface CreateOAuthSourceCredentialData {
  provider: string;
  microsoftClientId?: string;
  microsoftTenant?: string;
  microsoftScope?: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const createOAuthSourceCredential = async (
  userId: string,
  data: CreateOAuthSourceCredentialData,
  storage?: Pick<typeof database, "select" | "insert" | "update">,
): Promise<string> => {
  let databaseClient = storage;
  if (!databaseClient) {
    const context = await import("@/context");
    databaseClient = context.database;
  }
  const [existing] = await databaseClient
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
    await databaseClient
      .update(oauthCredentialsTable)
      .set({
        microsoftClientId: data.microsoftClientId ?? null,
        microsoftTenant: data.microsoftTenant ?? null,
        microsoftScope: data.microsoftScope ?? null,
        accessToken: data.accessToken,
        expiresAt: data.expiresAt,
        needsReauthentication: false,
        refreshToken: data.refreshToken,
      })
      .where(eq(oauthCredentialsTable.id, existing.id));

    return existing.id;
  }

  const [credential] = await databaseClient
    .insert(oauthCredentialsTable)
    .values({
      microsoftClientId: data.microsoftClientId ?? null,
      microsoftTenant: data.microsoftTenant ?? null,
        microsoftScope: data.microsoftScope ?? null,
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
};

export { createOAuthSourceCredential };
export type { CreateOAuthSourceCredentialData };
