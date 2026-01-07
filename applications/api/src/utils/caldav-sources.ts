import {
  caldavSourceCredentialsTable,
  calendarDestinationsTable,
  calendarSourcesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { encryptPassword } from "@keeper.sh/encryption";
import { database, premiumService, encryptionKey } from "../context";

const FIRST_RESULT_LIMIT = 1;
const CALDAV_SOURCE_TYPE = "caldav";

class CalDAVSourceLimitError extends Error {
  constructor() {
    super("Source limit reached. Upgrade to Pro for unlimited sources.");
  }
}

class CalDAVSourceNotFoundError extends Error {
  constructor() {
    super("CalDAV source not found or not owned by user");
  }
}

class DuplicateCalDAVSourceError extends Error {
  constructor() {
    super("This calendar is already added as a source");
  }
}

interface CalDAVSource {
  id: string;
  userId: string;
  name: string;
  provider: string;
  calendarUrl: string;
  serverUrl: string;
  username: string;
  createdAt: Date;
}

interface CreateCalDAVSourceData {
  calendarUrl: string;
  name: string;
  password: string;
  provider: string;
  serverUrl: string;
  username: string;
}

const getUserCalDAVSources = async (userId: string, provider?: string): Promise<CalDAVSource[]> => {
  const conditions = [
    eq(calendarSourcesTable.userId, userId),
    eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
  ];

  if (provider) {
    conditions.push(eq(calendarSourcesTable.provider, provider));
  }

  const sources = await database
    .select({
      calendarUrl: calendarSourcesTable.calendarUrl,
      createdAt: calendarSourcesTable.createdAt,
      id: calendarSourcesTable.id,
      name: calendarSourcesTable.name,
      provider: calendarSourcesTable.provider,
      serverUrl: caldavSourceCredentialsTable.serverUrl,
      userId: calendarSourcesTable.userId,
      username: caldavSourceCredentialsTable.username,
    })
    .from(calendarSourcesTable)
    .innerJoin(
      caldavSourceCredentialsTable,
      eq(calendarSourcesTable.caldavCredentialId, caldavSourceCredentialsTable.id),
    )
    .where(and(...conditions));

  return sources.map((source) => {
    if (!source.calendarUrl) {
      throw new Error(`CalDAV source ${source.id} is missing calendarUrl`);
    }
    if (!source.provider) {
      throw new Error(`CalDAV source ${source.id} is missing provider`);
    }
    return {
      ...source,
      calendarUrl: source.calendarUrl,
      provider: source.provider,
    };
  });
};

const countUserSources = async (userId: string): Promise<number> => {
  const caldavSources = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(eq(calendarSourcesTable.userId, userId));

  return caldavSources.length;
};

const createCalDAVSource = async (
  userId: string,
  data: CreateCalDAVSourceData,
): Promise<CalDAVSource> => {
  const existingSourceCount = await countUserSources(userId);
  const allowed = await premiumService.canAddSource(userId, existingSourceCount);

  if (!allowed) {
    throw new CalDAVSourceLimitError();
  }

  const [existingSource] = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(
      and(
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.calendarUrl, data.calendarUrl),
        eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (existingSource) {
    throw new DuplicateCalDAVSourceError();
  }

  if (!encryptionKey) {
    throw new Error("Encryption key not configured");
  }

  const encryptedPassword = encryptPassword(data.password, encryptionKey);

  const [credential] = await database
    .insert(caldavSourceCredentialsTable)
    .values({
      encryptedPassword,
      serverUrl: data.serverUrl,
      username: data.username,
    })
    .returning({ id: caldavSourceCredentialsTable.id });

  if (!credential) {
    throw new Error("Failed to create CalDAV source credential");
  }

  const [source] = await database
    .insert(calendarSourcesTable)
    .values({
      caldavCredentialId: credential.id,
      calendarUrl: data.calendarUrl,
      name: data.name,
      provider: data.provider,
      sourceType: CALDAV_SOURCE_TYPE,
      userId,
    })
    .returning();

  if (!source) {
    throw new Error("Failed to create CalDAV source");
  }

  const destinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  if (destinations.length > 0) {
    const mappings = destinations.map((destination) => ({
      destinationId: destination.id,
      sourceId: source.id,
    }));

    await database.insert(sourceDestinationMappingsTable).values(mappings);
  }

  return {
    calendarUrl: data.calendarUrl,
    createdAt: source.createdAt,
    id: source.id,
    name: source.name,
    provider: data.provider,
    serverUrl: data.serverUrl,
    userId: source.userId,
    username: data.username,
  };
};

const deleteCalDAVSource = async (userId: string, sourceId: string): Promise<boolean> => {
  const [source] = await database
    .select({ caldavCredentialId: calendarSourcesTable.caldavCredentialId })
    .from(calendarSourcesTable)
    .where(
      and(
        eq(calendarSourcesTable.id, sourceId),
        eq(calendarSourcesTable.userId, userId),
        eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  if (!source) {
    throw new CalDAVSourceNotFoundError();
  }

  await database
    .delete(calendarSourcesTable)
    .where(eq(calendarSourcesTable.id, sourceId));

  if (source.caldavCredentialId) {
    await database
      .delete(caldavSourceCredentialsTable)
      .where(eq(caldavSourceCredentialsTable.id, source.caldavCredentialId));
  }

  return true;
};

const verifyCalDAVSourceOwnership = async (
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
        eq(calendarSourcesTable.sourceType, CALDAV_SOURCE_TYPE),
      ),
    )
    .limit(FIRST_RESULT_LIMIT);

  return Boolean(source);
};

export {
  CalDAVSourceLimitError,
  CalDAVSourceNotFoundError,
  DuplicateCalDAVSourceError,
  getUserCalDAVSources,
  createCalDAVSource,
  deleteCalDAVSource,
  verifyCalDAVSourceOwnership,
};
