import {
  calendarDestinationsTable,
  oauthCalendarSourcesTable,
  oauthSourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { database } from "../context";

const EMPTY_COUNT = 0;

const getDestinationsForOAuthSource = async (oauthSourceId: string): Promise<string[]> => {
  const mappings = await database
    .select({ destinationId: oauthSourceDestinationMappingsTable.destinationId })
    .from(oauthSourceDestinationMappingsTable)
    .where(eq(oauthSourceDestinationMappingsTable.oauthSourceId, oauthSourceId));

  return mappings.map((mapping) => mapping.destinationId);
};

const updateOAuthSourceMappings = async (
  userId: string,
  oauthSourceId: string,
  destinationIds: string[],
): Promise<void> => {
  const userDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  const validDestinationIds = new Set(userDestinations.map((dest) => dest.id));
  const filteredDestinationIds = destinationIds.filter((id) => validDestinationIds.has(id));

  await database
    .delete(oauthSourceDestinationMappingsTable)
    .where(eq(oauthSourceDestinationMappingsTable.oauthSourceId, oauthSourceId));

  if (filteredDestinationIds.length > EMPTY_COUNT) {
    await database.insert(oauthSourceDestinationMappingsTable).values(
      filteredDestinationIds.map((destinationId) => ({
        destinationId,
        oauthSourceId,
      })),
    );
  }
};

const createOAuthSourceMappingsForNewSource = async (
  userId: string,
  oauthSourceId: string,
): Promise<void> => {
  const destinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  if (destinations.length > EMPTY_COUNT) {
    await database.insert(oauthSourceDestinationMappingsTable).values(
      destinations.map((dest) => ({
        destinationId: dest.id,
        oauthSourceId,
      })),
    );
  }
};

const createOAuthSourceMappingsForNewDestination = async (
  userId: string,
  destinationId: string,
): Promise<void> => {
  const oauthSources = await database
    .select({ id: oauthCalendarSourcesTable.id })
    .from(oauthCalendarSourcesTable)
    .where(eq(oauthCalendarSourcesTable.userId, userId));

  if (oauthSources.length > EMPTY_COUNT) {
    await database.insert(oauthSourceDestinationMappingsTable).values(
      oauthSources.map((source) => ({
        destinationId,
        oauthSourceId: source.id,
      })),
    );
  }
};

export {
  getDestinationsForOAuthSource,
  updateOAuthSourceMappings,
  createOAuthSourceMappingsForNewSource,
  createOAuthSourceMappingsForNewDestination,
};
