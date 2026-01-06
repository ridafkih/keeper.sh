import {
  calendarDestinationsTable,
  oauthCalendarSourcesTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database, premiumService } from "../context";
import { createOAuthSourceMappingsForNewSource } from "./oauth-source-destination-mappings";
import { triggerDestinationSync } from "./sync";

const FIRST_RESULT_LIMIT = 1;

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
  userId: string;
  destinationId: string;
  externalCalendarId: string;
  provider: string;
  name: string;
  email: string | null;
  createdAt: Date;
}

interface OAuthDestinationWithCredentials {
  destinationId: string;
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
      createdAt: oauthCalendarSourcesTable.createdAt,
      destinationId: oauthCalendarSourcesTable.destinationId,
      email: calendarDestinationsTable.email,
      externalCalendarId: oauthCalendarSourcesTable.externalCalendarId,
      id: oauthCalendarSourcesTable.id,
      name: oauthCalendarSourcesTable.name,
      provider: oauthCalendarSourcesTable.provider,
      userId: oauthCalendarSourcesTable.userId,
    })
    .from(oauthCalendarSourcesTable)
    .innerJoin(
      calendarDestinationsTable,
      eq(oauthCalendarSourcesTable.destinationId, calendarDestinationsTable.id),
    )
    .where(
      and(
        eq(oauthCalendarSourcesTable.userId, userId),
        eq(oauthCalendarSourcesTable.provider, provider),
      ),
    );

  return sources;
};

const verifyOAuthSourceOwnership = async (
  userId: string,
  sourceId: string,
): Promise<boolean> => {
  const [source] = await database
    .select({ id: oauthCalendarSourcesTable.id })
    .from(oauthCalendarSourcesTable)
    .where(
      and(
        eq(oauthCalendarSourcesTable.id, sourceId),
        eq(oauthCalendarSourcesTable.userId, userId),
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

const createOAuthSource = async (
  userId: string,
  destinationId: string,
  externalCalendarId: string,
  name: string,
  provider: string,
): Promise<OAuthCalendarSource> => {
  const destination = await getOAuthDestinationCredentials(userId, destinationId, provider);

  const existingSources = await database
    .select({ id: oauthCalendarSourcesTable.id })
    .from(oauthCalendarSourcesTable)
    .where(eq(oauthCalendarSourcesTable.userId, userId));

  const allowed = await premiumService.canAddSource(userId, existingSources.length);
  if (!allowed) {
    throw new OAuthSourceLimitError();
  }

  const [existingSource] = await database
    .select({ id: oauthCalendarSourcesTable.id })
    .from(oauthCalendarSourcesTable)
    .where(
      and(
        eq(oauthCalendarSourcesTable.userId, userId),
        eq(oauthCalendarSourcesTable.destinationId, destinationId),
        eq(oauthCalendarSourcesTable.externalCalendarId, externalCalendarId),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (existingSource) {
    throw new DuplicateSourceError();
  }

  const [source] = await database
    .insert(oauthCalendarSourcesTable)
    .values({
      destinationId,
      externalCalendarId,
      name,
      provider,
      userId,
    })
    .returning();

  if (!source) {
    throw new Error("Failed to create OAuth calendar source");
  }

  await createOAuthSourceMappingsForNewSource(userId, source.id);

  triggerDestinationSync(userId);

  return {
    ...source,
    email: destination.email,
  };
};

const deleteOAuthSource = async (userId: string, sourceId: string): Promise<boolean> => {
  const [deleted] = await database
    .delete(oauthCalendarSourcesTable)
    .where(
      and(
        eq(oauthCalendarSourcesTable.id, sourceId),
        eq(oauthCalendarSourcesTable.userId, userId),
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
  getUserOAuthSources,
  verifyOAuthSourceOwnership,
  getOAuthDestinationCredentials,
  createOAuthSource,
  deleteOAuthSource,
};

export type { OAuthCalendarSource, OAuthDestinationWithCredentials };
