import { oauthSourceCredentialsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database } from "../context";

const FIRST_RESULT_LIMIT = 1;

class SourceCredentialNotFoundError extends Error {
  constructor() {
    super("Source credential not found or not owned by user");
  }
}

class SourceCredentialProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Source credential is not a ${provider} account`);
  }
}

interface OAuthSourceCredential {
  id: string;
  userId: string;
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  needsReauthentication: boolean;
}

interface CreateOAuthSourceCredentialData {
  provider: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getUserOAuthSourceCredentials = async (
  userId: string,
  provider?: string,
): Promise<OAuthSourceCredential[]> => {
  const conditions = [eq(oauthSourceCredentialsTable.userId, userId)];

  if (provider) {
    conditions.push(eq(oauthSourceCredentialsTable.provider, provider));
  }

  const credentials = await database
    .select({
      accessToken: oauthSourceCredentialsTable.accessToken,
      email: oauthSourceCredentialsTable.email,
      expiresAt: oauthSourceCredentialsTable.expiresAt,
      id: oauthSourceCredentialsTable.id,
      needsReauthentication: oauthSourceCredentialsTable.needsReauthentication,
      provider: oauthSourceCredentialsTable.provider,
      refreshToken: oauthSourceCredentialsTable.refreshToken,
      userId: oauthSourceCredentialsTable.userId,
    })
    .from(oauthSourceCredentialsTable)
    .where(and(...conditions));

  return credentials;
};

const getOAuthSourceCredential = async (
  userId: string,
  credentialId: string,
  provider?: string,
): Promise<OAuthSourceCredential> => {
  const [credential] = await database
    .select({
      accessToken: oauthSourceCredentialsTable.accessToken,
      email: oauthSourceCredentialsTable.email,
      expiresAt: oauthSourceCredentialsTable.expiresAt,
      id: oauthSourceCredentialsTable.id,
      needsReauthentication: oauthSourceCredentialsTable.needsReauthentication,
      provider: oauthSourceCredentialsTable.provider,
      refreshToken: oauthSourceCredentialsTable.refreshToken,
      userId: oauthSourceCredentialsTable.userId,
    })
    .from(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.id, credentialId),
        eq(oauthSourceCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!credential) {
    throw new SourceCredentialNotFoundError();
  }

  if (provider && credential.provider !== provider) {
    throw new SourceCredentialProviderMismatchError(provider);
  }

  return credential;
};

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

const deleteOAuthSourceCredential = async (
  userId: string,
  credentialId: string,
): Promise<boolean> => {
  const [deleted] = await database
    .delete(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.id, credentialId),
        eq(oauthSourceCredentialsTable.userId, userId),
      ),
    )
    .returning({ id: oauthSourceCredentialsTable.id });

  return Boolean(deleted);
};

export {
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  getUserOAuthSourceCredentials,
  getOAuthSourceCredential,
  createOAuthSourceCredential,
  deleteOAuthSourceCredential,
};

export type { OAuthSourceCredential, CreateOAuthSourceCredentialData };
