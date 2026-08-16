import { eventMappingsTable, eventStatesTable } from "@keeper.sh/database/schema";
import { and, count, eq } from "drizzle-orm";
import type { BunSQLClient } from "../database-client";
import type { EventAvailability } from "../types";
import { parseAvailability } from "./availability";

const DEFAULT_COUNT = 0;

interface EventMapping {
  id: string;
  eventStateId: string | null;
  syncEventId: string;
  calendarId: string;
  sourceCalendarId: string | null;
  destinationEventUid: string;
  deleteIdentifier: string;
  syncEventHash: string | null;
  startTime: Date;
  endTime: Date;
  destinationAvailability?: EventAvailability | null;
  destinationContentHash?: string | null;
  destinationDescription?: string | null;
  destinationEndTime?: Date | null;
  destinationIsAllDay?: boolean | null;
  destinationLocation?: string | null;
  destinationStartTime?: Date | null;
  destinationSummary?: string | null;
  missingFirstObservedAt?: Date | null;
  missingObservationCount?: number;
  recurrenceId?: Date | null;
  recurrenceRule?: string | null;
  writeBackDailyCount?: number;
  writeBackDailyWindowStart?: Date | null;
  writeBackEpoch?: number;
  writeBackEpochWindowStart?: Date | null;
  writeBackLastAppliedAt?: Date | null;
}

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
      deleteIdentifier: eventMappingsTable.deleteIdentifier,
      destinationAvailability: eventMappingsTable.destinationAvailability,
      destinationContentHash: eventMappingsTable.destinationContentHash,
      destinationDescription: eventMappingsTable.destinationDescription,
      destinationEndTime: eventMappingsTable.destinationEndTime,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      destinationIsAllDay: eventMappingsTable.destinationIsAllDay,
      destinationLocation: eventMappingsTable.destinationLocation,
      destinationStartTime: eventMappingsTable.destinationStartTime,
      destinationSummary: eventMappingsTable.destinationSummary,
      endTime: eventMappingsTable.endTime,
      eventStateCalendarId: eventStatesTable.calendarId,
      eventStateId: eventMappingsTable.eventStateId,
      id: eventMappingsTable.id,
      missingFirstObservedAt: eventMappingsTable.missingFirstObservedAt,
      missingObservationCount: eventMappingsTable.missingObservationCount,
      recurrenceId: eventStatesTable.recurrenceId,
      recurrenceRule: eventStatesTable.recurrenceRule,
      sourceCalendarId: eventMappingsTable.sourceCalendarId,
      syncEventId: eventMappingsTable.syncEventId,
      syncEventHash: eventMappingsTable.syncEventHash,
      startTime: eventMappingsTable.startTime,
      writeBackDailyCount: eventMappingsTable.writeBackDailyCount,
      writeBackDailyWindowStart: eventMappingsTable.writeBackDailyWindowStart,
      writeBackEpoch: eventMappingsTable.writeBackEpoch,
      writeBackEpochWindowStart: eventMappingsTable.writeBackEpochWindowStart,
      writeBackLastAppliedAt: eventMappingsTable.writeBackLastAppliedAt,
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
      destinationAvailability: parseAvailability(mapping.destinationAvailability) ?? null,
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
  requireMappingSyncEventId,
  requireMappingSourceCalendarId,
};
export type { EventMapping };
