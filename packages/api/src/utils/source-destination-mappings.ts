import {
  sourceDestinationMappingsTable,
  remoteICalSourcesTable,
  calendarDestinationsTable,
} from "@keeper.sh/database/schema";
import { eq, and, inArray } from "drizzle-orm";
import { database } from "../context";

interface SourceDestinationMapping {
  id: string;
  sourceId: string;
  destinationId: string;
  createdAt: Date;
}

export const getUserMappings = async (
  userId: string,
): Promise<SourceDestinationMapping[]> => {
  const userSources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  const sourceIds = userSources.map((source) => source.id);

  if (sourceIds.length === 0) {
    return [];
  }

  return database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceId, sourceIds));
};

export const getSourcesForDestination = async (
  destinationId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ sourceId: sourceDestinationMappingsTable.sourceId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));

  return mappings.map((mapping) => mapping.sourceId);
};

export const getDestinationsForSource = async (
  sourceId: string,
): Promise<string[]> => {
  const mappings = await database
    .select({ destinationId: sourceDestinationMappingsTable.destinationId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));

  return mappings.map((mapping) => mapping.destinationId);
};

export const updateSourceMappings = async (
  userId: string,
  sourceId: string,
  destinationIds: string[],
): Promise<void> => {
  const userDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  const validDestinationIds = userDestinations.map((dest) => dest.id);
  const filteredDestinationIds = destinationIds.filter((destId) =>
    validDestinationIds.includes(destId),
  );

  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));

  if (filteredDestinationIds.length > 0) {
    const mappingsToInsert = filteredDestinationIds.map((destinationId) => ({
      sourceId,
      destinationId,
    }));

    await database
      .insert(sourceDestinationMappingsTable)
      .values(mappingsToInsert)
      .onConflictDoNothing();
  }
};

export const createMappingsForNewSource = async (
  userId: string,
  sourceId: string,
): Promise<void> => {
  const userDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  if (userDestinations.length === 0) {
    return;
  }

  const mappingsToInsert = userDestinations.map((destination) => ({
    sourceId,
    destinationId: destination.id,
  }));

  await database
    .insert(sourceDestinationMappingsTable)
    .values(mappingsToInsert)
    .onConflictDoNothing();
};

export const createMappingsForNewDestination = async (
  userId: string,
  destinationId: string,
): Promise<void> => {
  const userSources = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.userId, userId));

  if (userSources.length === 0) {
    return;
  }

  const mappingsToInsert = userSources.map((source) => ({
    sourceId: source.id,
    destinationId,
  }));

  await database
    .insert(sourceDestinationMappingsTable)
    .values(mappingsToInsert)
    .onConflictDoNothing();
};

export const deleteMappingsForSource = async (
  sourceId: string,
): Promise<void> => {
  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceId, sourceId));
};

export const deleteMappingsForDestination = async (
  destinationId: string,
): Promise<void> => {
  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationId, destinationId));
};
