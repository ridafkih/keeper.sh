import {
  calendarDestinationsTable,
  calendarSourcesTable,
  oauthCredentialsTable,
  oauthSourceCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database, premiumService } from "../context";
import { createMappingsForNewSource } from "./source-destination-mappings";
import { triggerDestinationSync } from "./sync";

const FIRST_RESULT_LIMIT = 1;
const OAUTH_SOURCE_TYPE = "oauth";

class OAuthSourceLimitError extends Error {
  constructor() {
    super("Source limit reached. Upgrade to Pro for unlimited sources.");
  }
}

class DestinationNotFoundError extends Error {
  constructor() {
    super("Destination not found or not owned by user");
  }
}

class DestinationProviderMismatchError extends Error {
  constructor(provider: string) {
    super(`Destination is not a ${provider} account`);
  }
}

class DuplicateSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

interface OAuthCalendarSource {
  id: string;
  name: string;
  provider: string;
  email: string | null;
}

interface OAuthDestinationWithCredentials {
  destinationId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface OAuthSourceWithCredentials {
  credentialId: string;
  email: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const getUserOAuthSources = async (
  userId: string,
  provider: string,
): Promise<OAuthCalendarSource[]> => {
  const sources = await database
    .select({
      createdAt: calendarSourcesTable.createdAt,
      email: oauthSourceCredentialsTable.email,
      externalCalendarId: calendarSourcesTable.externalCalendarId,
      id: calendarSourcesTable.id,
      name: calendarSourcesTable.name,
      oauthCredentialId: calendarSourcesTable.oauthCredentialId,
      provider: calendarSourcesTable.provider,
      userId: calendarSourcesTable.userId,
    })
    .from(calendarSourcesTable)
    .leftJoin(
      oauthSourceCredentialsTable,
      eq(calendarSourcesTable.oauthCredentialId, oauthSourceCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.sourceType, OAUTH_SOURCE_TYPE),
        eq(calendarSourcesTable.provider, provider),
      ),
    );

  return sources.map((source) => {
    if (!source.provider) {
      throw new Error(`OAuth source ${source.id} is missing provider`);
    }
    return {
      email: source.email,
      id: source.id,
      name: source.name,
      provider: source.provider,
    };
  });
};

const verifyOAuthSourceOwnership = async (
  userId: string,
  sourceId: string,
): Promise<boolean> => {
  const [source] = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(
      and(
        eq(calendarSourcesTable.id, sourceId),
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.sourceType, OAUTH_SOURCE_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

const getOAuthDestinationCredentials = async (
  userId: string,
  destinationId: string,
  provider: string,
): Promise<OAuthDestinationWithCredentials> => {
  const [result] = await database
    .select({
      accessToken: oauthCredentialsTable.accessToken,
      destinationId: calendarDestinationsTable.id,
      email: calendarDestinationsTable.email,
      expiresAt: oauthCredentialsTable.expiresAt,
      provider: calendarDestinationsTable.provider,
      refreshToken: oauthCredentialsTable.refreshToken,
    })
    .from(calendarDestinationsTable)
    .innerJoin(
      oauthCredentialsTable,
      eq(calendarDestinationsTable.oauthCredentialId, oauthCredentialsTable.id),
    )
    .where(
      and(
        eq(calendarDestinationsTable.id, destinationId),
        eq(calendarDestinationsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new DestinationNotFoundError();
  }

  if (result.provider !== provider) {
    throw new DestinationProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    destinationId: result.destinationId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

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

const getOAuthSourceCredentials = async (
  userId: string,
  credentialId: string,
  provider: string,
): Promise<OAuthSourceWithCredentials> => {
  const [result] = await database
    .select({
      accessToken: oauthSourceCredentialsTable.accessToken,
      credentialId: oauthSourceCredentialsTable.id,
      email: oauthSourceCredentialsTable.email,
      expiresAt: oauthSourceCredentialsTable.expiresAt,
      provider: oauthSourceCredentialsTable.provider,
      refreshToken: oauthSourceCredentialsTable.refreshToken,
    })
    .from(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.id, credentialId),
        eq(oauthSourceCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!result) {
    throw new SourceCredentialNotFoundError();
  }

  if (result.provider !== provider) {
    throw new SourceCredentialProviderMismatchError(provider);
  }

  return {
    accessToken: result.accessToken,
    credentialId: result.credentialId,
    email: result.email,
    expiresAt: result.expiresAt,
    refreshToken: result.refreshToken,
  };
};

interface CreateOAuthSourceOptions {
  userId: string;
  externalCalendarId: string;
  name: string;
  provider: string;
  oauthCredentialId: string;
}

const createOAuthSource = async (
  options: CreateOAuthSourceOptions,
): Promise<OAuthCalendarSource> => {
  const { userId, externalCalendarId, name, provider, oauthCredentialId } = options;

  const [credential] = await database
    .select({ email: oauthSourceCredentialsTable.email })
    .from(oauthSourceCredentialsTable)
    .where(
      and(
        eq(oauthSourceCredentialsTable.id, oauthCredentialId),
        eq(oauthSourceCredentialsTable.userId, userId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!credential) {
    throw new Error("Source credential not found");
  }

  const existingSources = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(eq(calendarSourcesTable.userId, userId));

  const allowed = await premiumService.canAddSource(userId, existingSources.length);
  if (!allowed) {
    throw new OAuthSourceLimitError();
  }

  const [existingSource] = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(
      and(
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.externalCalendarId, externalCalendarId),
        eq(calendarSourcesTable.oauthCredentialId, oauthCredentialId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (existingSource) {
    throw new DuplicateSourceError();
  }

  const [source] = await database
    .insert(calendarSourcesTable)
    .values({
      externalCalendarId,
      name,
      oauthCredentialId,
      provider,
      sourceType: OAUTH_SOURCE_TYPE,
      userId,
    })
    .returning();

  if (!source) {
    throw new Error("Failed to create OAuth calendar source");
  }

  await createMappingsForNewSource(userId, source.id);

  triggerDestinationSync(userId);

  return {
    email: credential.email,
    id: source.id,
    name: source.name,
    provider,
  };
};

const deleteOAuthSource = async (userId: string, sourceId: string): Promise<boolean> => {
  const [deleted] = await database
    .delete(calendarSourcesTable)
    .where(
      and(
        eq(calendarSourcesTable.id, sourceId),
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.sourceType, OAUTH_SOURCE_TYPE),
      ),
    )
    .returning();

  if (deleted) {
    triggerDestinationSync(userId);
    return true;
  }

  return false;
};

export {
  OAuthSourceLimitError,
  DestinationNotFoundError,
  DestinationProviderMismatchError,
  DuplicateSourceError,
  SourceCredentialNotFoundError,
  SourceCredentialProviderMismatchError,
  getUserOAuthSources,
  verifyOAuthSourceOwnership,
  getOAuthDestinationCredentials,
  getOAuthSourceCredentials,
  createOAuthSource,
  deleteOAuthSource,
};

export type {
  OAuthCalendarSource,
  OAuthDestinationWithCredentials,
  OAuthSourceWithCredentials,
  CreateOAuthSourceOptions,
};
