import { eventMappingsTable } from "@keeper.sh/database/schema";
import { and, count, eq, sql } from "drizzle-orm";
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

const getEventMappingsForDestination = (
  database: BunSQLDatabase,
  destinationId: string,
): Promise<EventMapping[]> =>
  database
    .select({
      deleteIdentifier: sql<string>`coalesce(${eventMappingsTable.deleteIdentifier}, ${eventMappingsTable.destinationEventUid})`,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      destinationId: eventMappingsTable.destinationId,
      endTime: eventMappingsTable.endTime,
      eventStateId: eventMappingsTable.eventStateId,
      id: eventMappingsTable.id,
      startTime: eventMappingsTable.startTime,
    })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.destinationId, destinationId));

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
  await database.insert(eventMappingsTable).values(params).onConflictDoNothing();
};

const deleteEventMapping = async (database: BunSQLDatabase, mappingId: string): Promise<void> => {
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
