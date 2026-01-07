import {
  calendarDestinationsTable,
  calendarSourcesTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { eq, inArray } from "drizzle-orm";
import { database } from "../context";

const EMPTY_LIST_COUNT = 0;

interface SourceDestinationMapping {
  id: string;
  sourceId: string;
  destinationId: string;
  createdAt: Date;
  sourceType: string;
}

const getUserMappings = async (userId: string): Promise<SourceDestinationMapping[]> => {
  const userSources = await database
    .select({
      id: calendarSourcesTable.id,
      sourceType: calendarSourcesTable.sourceType,
    })
    .from(calendarSourcesTable)
    .where(eq(calendarSourcesTable.userId, userId));

  if (userSources.length === EMPTY_LIST_COUNT) {
    return [];
  }

  const sourceIds = userSources.map((source) => source.id);
  const sourceTypeMap = new Map(userSources.map((source) => [source.id, source.sourceType]));

  const mappings = await database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceId, sourceIds));

  return mappings.map((mapping) => ({
    ...mapping,
    sourceType: sourceTypeMap.get(mapping.sourceId) ?? "unknown",
  }));
};

const getDestinationsForSource = async (sourceId: string): Promise<string[]> => {
  const mappings = await database
    .select({ destinationId: sourceDestinationMappingsTable.destinationId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));

  return mappings.map((mapping) => mapping.destinationId);
};

const updateSourceMappings = async (
  userId: string,
  sourceId: string,
  destinationIds: string[],
): Promise<void> => {
  const userDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  const validDestinationIds = new Set(userDestinations.map((dest) => dest.id));
  const filteredDestinationIds = destinationIds.filter((destId) => validDestinationIds.has(destId));

  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));

  if (filteredDestinationIds.length > EMPTY_LIST_COUNT) {
    const mappingsToInsert = filteredDestinationIds.map((destinationId) => ({
      destinationId,
      sourceId,
    }));

    await database
      .insert(sourceDestinationMappingsTable)
      .values(mappingsToInsert)
      .onConflictDoNothing();
  }
};

const createMappingsForNewSource = async (userId: string, sourceId: string): Promise<void> => {
  const userDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  if (userDestinations.length === EMPTY_LIST_COUNT) {
    return;
  }

  const mappingsToInsert = userDestinations.map((destination) => ({
    destinationId: destination.id,
    sourceId,
  }));

  await database
    .insert(sourceDestinationMappingsTable)
    .values(mappingsToInsert)
    .onConflictDoNothing();
};

const createMappingsForNewDestination = async (
  userId: string,
  destinationId: string,
): Promise<void> => {
  const userSources = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(eq(calendarSourcesTable.userId, userId));

  if (userSources.length === EMPTY_LIST_COUNT) {
    return;
  }

  const mappingsToInsert = userSources.map((source) => ({
    destinationId,
    sourceId: source.id,
  }));

  await database
    .insert(sourceDestinationMappingsTable)
    .values(mappingsToInsert)
    .onConflictDoNothing();
};

export {
  getUserMappings,
  getDestinationsForSource,
  updateSourceMappings,
  createMappingsForNewSource,
  createMappingsForNewDestination,
};
