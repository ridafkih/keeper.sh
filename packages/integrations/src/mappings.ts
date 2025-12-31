import { eventMappingsTable } from "@keeper.sh/database/schema";
import { and, count, eq, sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export interface EventMapping {
  id: string;
  eventStateId: string;
  destinationId: string;
  destinationEventUid: string;
  deleteIdentifier: string;
  startTime: Date;
  endTime: Date;
}

export async function getEventMappingsForDestination(
  database: BunSQLDatabase,
  destinationId: string,
): Promise<EventMapping[]> {
  return database
    .select({
      id: eventMappingsTable.id,
      eventStateId: eventMappingsTable.eventStateId,
      destinationId: eventMappingsTable.destinationId,
      destinationEventUid: eventMappingsTable.destinationEventUid,
      deleteIdentifier: sql<string>`coalesce(${eventMappingsTable.deleteIdentifier}, ${eventMappingsTable.destinationEventUid})`,
      startTime: eventMappingsTable.startTime,
      endTime: eventMappingsTable.endTime,
    })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.destinationId, destinationId));
}

export async function createEventMapping(
  database: BunSQLDatabase,
  params: {
    eventStateId: string;
    destinationId: string;
    destinationEventUid: string;
    deleteIdentifier?: string;
    startTime: Date;
    endTime: Date;
  },
): Promise<void> {
  await database
    .insert(eventMappingsTable)
    .values(params)
    .onConflictDoNothing();
}

export async function deleteEventMapping(
  database: BunSQLDatabase,
  mappingId: string,
): Promise<void> {
  await database
    .delete(eventMappingsTable)
    .where(eq(eventMappingsTable.id, mappingId));
}

export async function deleteEventMappingByDestinationUid(
  database: BunSQLDatabase,
  destinationId: string,
  destinationEventUid: string,
): Promise<void> {
  await database
    .delete(eventMappingsTable)
    .where(
      and(
        eq(eventMappingsTable.destinationId, destinationId),
        eq(eventMappingsTable.destinationEventUid, destinationEventUid),
      ),
    );
}

export async function countMappingsForDestination(
  database: BunSQLDatabase,
  destinationId: string,
): Promise<number> {
  const [result] = await database
    .select({ count: count() })
    .from(eventMappingsTable)
    .where(eq(eventMappingsTable.destinationId, destinationId));
  return result?.count ?? 0;
}
