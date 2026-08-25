import { eventMappingsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type { EventAvailability } from "../types";

const DEFAULT_COUNT = 0;

interface EventMapping {
  id: string;
  // Absent on mappings built before the counter existed, which reads as "no failures yet".
  consecutiveUpdateFailures?: number;
  eventStateId: string | null;
  syncEventId: string;
  calendarId: string;
  sourceCalendarId: string | null;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  remoteContentHash: string | null;
  /* The form the destination held when we last rewrote this event's own text, if we did. */
  remoteContentHashRepairedFrom?: string | null;
  /* What the destination was last seen holding, not what we meant to write. */
  remoteStartTime: Date | null;
  remoteEndTime: Date | null;
  remoteAvailability: EventAvailability | null;
  startTime: Date;
  endTime: Date;
}

const isEventAvailability = (value: string | null): value is EventAvailability =>
  value === "busy"
  || value === "free"
  || value === "oof"
  || value === "workingElsewhere";

const parseRecordedAvailability = (value: string | null): EventAvailability | null => {
  if (!isEventAvailability(value)) {
    return null;
  }
  return value;
};

const requireMappingSyncEventId = (
  mapping: { eventStateId: string | null; id: string; syncEventId: string | null },
): string => {
  const syncEventId = mapping.syncEventId ?? mapping.eventStateId;
  if (!syncEventId) {
    throw new Error(`Event mapping ${mapping.id} has no sync identity`);
  }
  return syncEventId;
};

const requireMappingSourceCalendarId = (
  mapping: {
    eventStateId: string | null;
    eventStateCalendarId: string | null;
    id: string;
    sourceCalendarId: string | null;
  },
): string | null => {
  const sourceCalendarId = mapping.sourceCalendarId ?? mapping.eventStateCalendarId;
  if (!sourceCalendarId && mapping.eventStateId !== null) {
    throw new Error(`Event mapping ${mapping.id} has no source calendar identity`);
  }
  return sourceCalendarId;
};

const getEventMappingsForDestination = async (
  database: BunSQLClient,
  calendarId: string,
): Promise<EventMapping[]> => {
  const mappings = await database
    .select({
      calendarId: eventMappingsTable.calendarId,
      consecutiveUpdateFailures: eventMappingsTable.consecutiveUpdateFailures,
      deleteIdentifier: eventMappingsTable.deleteIdentifier,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      endTime: eventMappingsTable.endTime,
      eventStateCalendarId: eventStatesTable.calendarId,
      eventStateId: eventMappingsTable.eventStateId,
      id: eventMappingsTable.id,
      remoteAvailability: eventMappingsTable.remoteAvailability,
      remoteContentHash: eventMappingsTable.remoteContentHash,
      remoteContentHashRepairedFrom: eventMappingsTable.remoteContentHashRepairedFrom,
      remoteEndTime: eventMappingsTable.remoteEndTime,
      remoteStartTime: eventMappingsTable.remoteStartTime,
      sourceCalendarId: eventMappingsTable.sourceCalendarId,
      syncEventId: eventMappingsTable.syncEventId,
      syncEventHash: eventMappingsTable.syncEventHash,
      startTime: eventMappingsTable.startTime,
    })
    .from(eventMappingsTable)
    .leftJoin(eventStatesTable, eq(eventMappingsTable.eventStateId, eventStatesTable.id))
    .where(eq(eventMappingsTable.calendarId, calendarId));

  return mappings.map((mapping) => {
    const syncEventId = requireMappingSyncEventId(mapping);
    const sourceCalendarId = requireMappingSourceCalendarId(mapping);
    return {
      ...mapping,
      deleteIdentifier: mapping.deleteIdentifier ?? mapping.destinationEventUid,
      remoteAvailability: parseRecordedAvailability(mapping.remoteAvailability),
      sourceCalendarId,
      syncEventId,
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
    remoteContentHash?: string;
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
      remoteContentHash: params.remoteContentHash,
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
  requireMappingSyncEventId,
  requireMappingSourceCalendarId,
};
export type { EventMapping };
