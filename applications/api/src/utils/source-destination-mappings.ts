import {
  calendarsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { database } from "../context";

const EMPTY_LIST_COUNT = 0;

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
  // Verify source ownership
  const [source] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(and(eq(calendarsTable.id, sourceCalendarId), eq(calendarsTable.userId, userId)))
    .limit(1);

  if (!source) throw new Error("Source calendar not found");

  // Verify destination ownership
  if (destinationCalendarIds.length > 0) {
    const validDestinations = await database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, destinationCalendarIds),
        ),
      );

    const validIds = new Set(validDestinations.map((d) => d.id));
    const invalid = destinationCalendarIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) throw new Error("Some destination calendars not found");
  }

  // Delete existing mappings for this source
  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.sourceCalendarId, sourceCalendarId));

  // Insert new mappings
  if (destinationCalendarIds.length > 0) {
    await database
      .insert(sourceDestinationMappingsTable)
      .values(
        destinationCalendarIds.map((destinationCalendarId) => ({
          destinationCalendarId,
          sourceCalendarId,
        })),
      )
      .onConflictDoNothing();

    // Ensure sync_status exists for each destination
    for (const destinationId of destinationCalendarIds) {
      await database
        .insert(syncStatusTable)
        .values({ calendarId: destinationId })
        .onConflictDoNothing();
    }
  }
};

const setSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<void> => {
  const [destination] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(and(eq(calendarsTable.id, destinationCalendarId), eq(calendarsTable.userId, userId)))
    .limit(1);

  if (!destination) throw new Error("Destination calendar not found");

  if (sourceCalendarIds.length > 0) {
    const validSources = await database
      .select({ id: calendarsTable.id })
      .from(calendarsTable)
      .where(
        and(
          eq(calendarsTable.userId, userId),
          inArray(calendarsTable.id, sourceCalendarIds),
        ),
      );

    const validIds = new Set(validSources.map((s) => s.id));
    const invalid = sourceCalendarIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) throw new Error("Some source calendars not found");
  }

  await database
    .delete(sourceDestinationMappingsTable)
    .where(eq(sourceDestinationMappingsTable.destinationCalendarId, destinationCalendarId));

  if (sourceCalendarIds.length > 0) {
    await database
      .insert(sourceDestinationMappingsTable)
      .values(
        sourceCalendarIds.map((sourceCalendarId) => ({
          sourceCalendarId,
          destinationCalendarId,
        })),
      )
      .onConflictDoNothing();

    await database
      .insert(syncStatusTable)
      .values({ calendarId: destinationCalendarId })
      .onConflictDoNothing();
  }
};

export {
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  setDestinationsForSource,
  setSourcesForDestination,
};
