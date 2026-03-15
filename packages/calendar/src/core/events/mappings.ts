import { eventMappingsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const DEFAULT_COUNT = 0;

interface EventMapping {
  id: string;
  eventStateId: string;
  calendarId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  startTime: Date;
  endTime: Date;
}

const getEventMappingsForDestination = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<EventMapping[]> => {
  const mappings = await database
    .select({
      calendarId: eventMappingsTable.calendarId,
      deleteIdentifier: eventMappingsTable.deleteIdentifier,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      endTime: eventMappingsTable.endTime,
      eventStateId: eventMappingsTable.eventStateId,
      id: eventMappingsTable.id,
      syncEventHash: eventMappingsTable.syncEventHash,
      startTime: eventMappingsTable.startTime,
    })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.calendarId, calendarId));

  return mappings.map((mapping) => ({
    ...mapping,
    deleteIdentifier: mapping.deleteIdentifier ?? mapping.destinationEventUid,
  }));
};

const createEventMapping = async (
  database: BunSQLDatabase,
  params: {
    eventStateId: string;
    calendarId: string;
    destinationEventUid: string;
    deleteIdentifier?: string;
    syncEventHash?: string;
    startTime: Date;
    endTime: Date;
  },
): Promise<void> => {
  await database
    .insert(eventMappingsTable)
    .values({
      calendarId: params.calendarId,
      deleteIdentifier: params.deleteIdentifier,
      destinationEventUid: params.destinationEventUid,
      endTime: params.endTime,
      eventStateId: params.eventStateId,
      syncEventHash: params.syncEventHash,
      startTime: params.startTime,
    })
    .onConflictDoNothing();
};

const deleteEventMapping = async (database: BunSQLDatabase, mappingId: string): Promise<void> => {
  await database.delete(eventMappingsTable).where(eq(eventMappingsTable.id, mappingId));
};

const deleteEventMappingByDestinationUid = async (
  database: BunSQLDatabase,
  calendarId: string,
  destinationEventUid: string,
): Promise<void> => {
  await database
    .delete(eventMappingsTable)
    .where(
      and(
        eq(eventMappingsTable.calendarId, calendarId),
        eq(eventMappingsTable.destinationEventUid, destinationEventUid),
      ),
    );
};

const countMappingsForDestination = async (
  database: BunSQLDatabase,
  calendarId: string,
): Promise<number> => {
  const [result] = await database
    .select({ count: count() })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.calendarId, calendarId));

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
