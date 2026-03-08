import {
  calendarsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { database } from "../context";
import { triggerDestinationSync } from "./sync";

const EMPTY_LIST_COUNT = 0;
const USER_MAPPING_LOCK_NAMESPACE = 9001;

interface SourceDestinationMapping {
  id: string;
  sourceCalendarId: string;
  destinationCalendarId: string;
  createdAt: Date;
  calendarType: string;
}

const getUserMappings = async (userId: string): Promise<SourceDestinationMapping[]> => {
  const userSourceCalendars = await database
    .select({
      calendarType: calendarsTable.calendarType,
      id: calendarsTable.id,
    })
    .from(calendarsTable)
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(calendarsTable.id,
          database.selectDistinct({ id: sourceDestinationMappingsTable.sourceCalendarId })
            .from(sourceDestinationMappingsTable)
        ),
      ),
    );

  if (userSourceCalendars.length === EMPTY_LIST_COUNT) {
    return [];
  }

  const calendarIds = userSourceCalendars.map((calendar) => calendar.id);
  const typeMap = new Map(userSourceCalendars.map((calendar) => [calendar.id, calendar.calendarType]));

  const mappings = await database
    .select()
    .from(sourceDestinationMappingsTable)
    .where(inArray(sourceDestinationMappingsTable.sourceCalendarId, calendarIds));

  return mappings.map((mapping) => ({
    ...mapping,
    calendarType: typeMap.get(mapping.sourceCalendarId) ?? "unknown",
  }));
};

const getDestinationsForSource = async (sourceCalendarId: string): Promise<string[]> => {
  const mappings = await database
    .select({ destinationCalendarId: sourceDestinationMappingsTable.destinationCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

  return mappings.map((mapping) => mapping.destinationCalendarId);
};

const getSourcesForDestination = async (destinationCalendarId: string): Promise<string[]> => {
  const mappings = await database
    .select({ sourceCalendarId: sourceDestinationMappingsTable.sourceCalendarId })
    .from(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  return mappings.map((mapping) => mapping.sourceCalendarId);
};

const setDestinationsForSource = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarIds: string[],
): Promise<void> => {
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_MAPPING_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const [source] = await tx
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(and(eq(calendarsTable.id, sourceCalendarId), eq(calendarsTable.userId, userId)))
      .limit(1);

    if (!source) throw new Error("Source calendar not found");

    if (destinationCalendarIds.length > 0) {
      const validDestinations = await tx
        .select({ id: calendarsTable.id })
        .from(calendarsTable)
        .where(
          and(
            eq(calendarsTable.userId, userId),
            inArray(calendarsTable.id, destinationCalendarIds),
          ),
        );

      const validIds = new Set(validDestinations.map((destination) => destination.id));
      const invalid = destinationCalendarIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) throw new Error("Some destination calendars not found");
    }

    await tx
      .delete(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

    if (destinationCalendarIds.length > 0) {
      await tx
        .insert(sourceDestinationMappingsTable)
        .values(
          destinationCalendarIds.map((destinationCalendarId) => ({
            destinationCalendarId,
            sourceCalendarId,
          })),
        )
        .onConflictDoNothing();

      for (const destinationId of destinationCalendarIds) {
        await tx
          .insert(syncStatusTable)
          .values({ calendarId: destinationId })
          .onConflictDoNothing();
      }
    }
  });

  triggerDestinationSync(userId);
};

const setSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<void> => {
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${USER_MAPPING_LOCK_NAMESPACE}, hashtext(${userId}))`,
    );

    const [destination] = await tx
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(and(eq(calendarsTable.id, destinationCalendarId), eq(calendarsTable.userId, userId)))
      .limit(1);

    if (!destination) throw new Error("Destination calendar not found");

    if (sourceCalendarIds.length > 0) {
      const validSources = await tx
        .select({ id: calendarsTable.id })
        .from(calendarsTable)
        .where(
          and(
            eq(calendarsTable.userId, userId),
            inArray(calendarsTable.id, sourceCalendarIds),
          ),
        );

      const validIds = new Set(validSources.map((source) => source.id));
      const invalid = sourceCalendarIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) throw new Error("Some source calendars not found");
    }

    await tx
      .delete(sourceDestinationMappingsTable)
      .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

    if (sourceCalendarIds.length > 0) {
      await tx
        .insert(sourceDestinationMappingsTable)
        .values(
          sourceCalendarIds.map((sourceCalendarId) => ({
            sourceCalendarId,
            destinationCalendarId,
          })),
        )
        .onConflictDoNothing();

      await tx
        .insert(syncStatusTable)
        .values({ calendarId: destinationCalendarId })
        .onConflictDoNothing();
    }
  });

  triggerDestinationSync(userId);
};

export {
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  setDestinationsForSource,
  setSourcesForDestination,
};
