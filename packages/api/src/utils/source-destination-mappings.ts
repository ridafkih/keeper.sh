import {
  calendarDestinationsTable,
  remoteICalSourcesTable,
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
}

const getUserMappings = async (userId: string): Promise<SourceDestinationMapping[]> => {
  const userSources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  const sourceIds = userSources.map((source) => source.id);

  if (sourceIds.length === EMPTY_LIST_COUNT) {
    return [];
  }

  return database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceId, sourceIds));
};

const getSourcesForDestination = async (destinationId: string): Promise<string[]> => {
  const mappings = await database
    .select({ sourceId: sourceDestinationMappingsTable.sourceId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));

  return mappings.map((mapping) => mapping.sourceId);
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
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

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

const deleteMappingsForSource = async (sourceId: string): Promise<void> => {
  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));
};

const deleteMappingsForDestination = async (destinationId: string): Promise<void> => {
  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));
};

export {
  getUserMappings,
  getSourcesForDestination,
  getDestinationsForSource,
  updateSourceMappings,
  createMappingsForNewSource,
  createMappingsForNewDestination,
  deleteMappingsForSource,
  deleteMappingsForDestination,
};
