import { eventMappingsTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";

const DEFAULT_COUNT = 0;

interface EventMapping {
  id: string;
  eventStateId: string | null;
  syncEventId?: string;
  calendarId: string;
  sourceCalendarId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  startTime: Date;
  endTime: Date;
}

const getEventMappingsForDestination = async (
  database: BunSQLClient,
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
      sourceCalendarId: eventMappingsTable.sourceCalendarId,
      syncEventId: eventMappingsTable.syncEventId,
      syncEventHash: eventMappingsTable.syncEventHash,
      startTime: eventMappingsTable.startTime,
    })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.calendarId, calendarId));

  return mappings.map((mapping) => {
    const { syncEventId: storedSyncEventId, ...mappingWithoutSyncEventId } = mapping;
    const syncEventId = storedSyncEventId ?? mapping.eventStateId;
    return {
      ...mappingWithoutSyncEventId,
      deleteIdentifier: mapping.deleteIdentifier ?? mapping.destinationEventUid,
      ...(syncEventId && { syncEventId }),
    };
  });
};

const createEventMapping = async (
  database: BunSQLClient,
  params: {
    eventStateId: string;
    sourceCalendarId: string;
    syncEventId: string;
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
      sourceCalendarId: params.sourceCalendarId,
      syncEventId: params.syncEventId,
      syncEventHash: params.syncEventHash,
      startTime: params.startTime,
    })
    .onConflictDoNothing();
};

const deleteEventMapping = async (database: BunSQLClient, mappingId: string): Promise<void> => {
  await database.delete(eventMappingsTable).where(eq(eventMappingsTable.id, mappingId));
};

const deleteEventMappingByDestinationUid = async (
  database: BunSQLClient,
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
  database: BunSQLClient,
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
