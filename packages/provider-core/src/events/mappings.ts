import { eventMappingsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const DEFAULT_COUNT = 0;

interface EventMapping {
  id: string;
  eventStateId: string;
  destinationId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  startTime: Date;
  endTime: Date;
}

const getEventMappingsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<EventMapping[]> => {
  const mappings = await database
    .select({
      deleteIdentifier: eventMappingsTable.deleteIdentifier,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      destinationId: eventMappingsTable.destinationId,
      endTime: eventMappingsTable.endTime,
      eventStateId: eventMappingsTable.eventStateId,
      id: eventMappingsTable.id,
      startTime: eventMappingsTable.startTime,
    })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.destinationId, destinationId));

  return mappings.map((mapping) => ({
    ...mapping,
    deleteIdentifier: mapping.deleteIdentifier ?? mapping.destinationEventUid,
  }));
};

const createEventMapping = async (
  database: BunSQLDatabase,
  params: {
    eventStateId: string;
    destinationId: string;
    destinationEventUid: string;
    deleteIdentifier?: string;
    startTime: Date;
    endTime: Date;
  },
): Promise<void> => {
  await database
    .insert(eventMappingsTable)
    .values({
      deleteIdentifier: params.deleteIdentifier,
      destinationEventUid: params.destinationEventUid,
      destinationId: params.destinationId,
      endTime: params.endTime,
      eventStateId: params.eventStateId,
      startTime: params.startTime,
    })
    .onConflictDoNothing();
};

const deleteEventMapping = async (
  database: BunSQLDatabase,
  mappingId: string,
): Promise<void> => {
  await database.delete(eventMappingsTable).where(eq(eventMappingsTable.id, mappingId));
};

const deleteEventMappingByDestinationUid = async (
  database: BunSQLDatabase,
  destinationId: string,
  destinationEventUid: string,
): Promise<void> => {
  await database
    .delete(eventMappingsTable)
    .where(
      and(
        eq(eventMappingsTable.destinationId, destinationId),
        eq(eventMappingsTable.destinationEventUid, destinationEventUid),
      ),
    );
};

const countMappingsForDestination = async (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<number> => {
  const [result] = await database
    .select({ count: count() })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.destinationId, destinationId));

  return result?.count ?? DEFAULT_COUNT;
};

export {
  getEventMappingsForDestination,
  createEventMapping,
  deleteEventMapping,
  deleteEventMappingByDestinationUid,
  countMappingsForDestination,
};
export type { EventMapping };
