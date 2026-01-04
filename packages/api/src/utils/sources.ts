import { remoteICalSourcesTable } from "@keeper.sh/database/schema";
import {
  pullRemoteCalendar,
  fetchAndSyncSource,
  CalendarFetchError,
} from "@keeper.sh/calendar";
import { eq, and } from "drizzle-orm";
import { triggerDestinationSync } from "./sync";
import { createMappingsForNewSource } from "./source-destination-mappings";
import { database, premiumService } from "../context";

export class SourceLimitError extends Error {
  constructor() {
    super("Source limit reached. Upgrade to Pro for unlimited sources.");
  }
}

export class InvalidSourceUrlError extends Error {
  public readonly authRequired: boolean;

  constructor(cause?: unknown) {
    if (cause instanceof CalendarFetchError) {
      super(cause.message);
      this.authRequired = cause.authRequired;
    } else {
      super("Invalid calendar URL");
      this.authRequired = false;
    }
    this.cause = cause;
  }
}

interface Source {
  id: string;
  userId: string;
  name: string;
  url: string;
  createdAt: Date;
}

export const getUserSources = async (userId: string): Promise<Source[]> => {
  return database
    .select()
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));
};

export const verifySourceOwnership = async (
  userId: string,
  sourceId: string,
): Promise<boolean> => {
  const [source] = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(
      and(
        eq(remoteICalSourcesTable.id, sourceId),
        eq(remoteICalSourcesTable.userId, userId),
      ),
    )
    .limit(1);

  return source !== undefined;
};

/**
 * Validates that a URL returns a valid iCal file.
 * Throws an error if invalid.
 */
const validateSourceUrl = async (url: string): Promise<void> => {
  await pullRemoteCalendar("json", url);
};

/**
 * Creates a new source for a user.
 * Validates the URL, checks limits, and triggers initial sync.
 * Throws if limit reached or URL invalid.
 */
export const createSource = async (
  userId: string,
  name: string,
  url: string,
): Promise<Source> => {
  const existingSources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  const allowed = await premiumService.canAddSource(userId, existingSources.length);
  if (!allowed) {
    throw new SourceLimitError();
  }

  try {
    await validateSourceUrl(url);
  } catch (error) {
    throw new InvalidSourceUrlError(error);
  }

  const [source] = await database
    .insert(remoteICalSourcesTable)
    .values({ userId, name, url })
    .returning();

  if (!source) {
    throw new Error("Failed to create source");
  }

  await createMappingsForNewSource(userId, source.id);

  fetchAndSyncSource(database, source)
    .then(() => triggerDestinationSync(userId))
    .catch(() => {});

  return source;
};

/**
 * Deletes a source owned by a user.
 * Returns true if deleted, false if not found.
 * Triggers destination sync after deletion.
 */
export const deleteSource = async (
  userId: string,
  sourceId: string,
): Promise<boolean> => {
  const [deleted] = await database
    .delete(remoteICalSourcesTable)
    .where(
      and(
        eq(remoteICalSourcesTable.id, sourceId),
        eq(remoteICalSourcesTable.userId, userId),
      ),
    )
    .returning();

  if (deleted) {
    triggerDestinationSync(userId);
    return true;
  }

  return false;
};
