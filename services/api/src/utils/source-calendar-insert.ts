import { calendarsTable, icalFeedCalendarsTable } from "@keeper.sh/database/schema";
import type { database as contextDatabase } from "@/context";
import { applySourceSyncDefaults } from "@keeper.sh/data-schemas";
import { ensureDefaultFeedForClient } from "./ical-feeds";

const EMPTY_LIST_COUNT = 0;

type SourceCalendarClient = Pick<typeof contextDatabase, "insert" | "select">;

interface InsertedSourceCalendar {
  id: string;
  includeInIcalFeed: boolean;
}

interface SourceCalendarInsertDependencies<TCalendar extends InsertedSourceCalendar> {
  insertCalendars: (values: Record<string, unknown>[]) => Promise<TCalendar[]>;
  ensureDefaultFeed: (userId: string) => Promise<{ id: string }>;
  insertFeedCalendars: (rows: { feedId: string; calendarId: string }[]) => Promise<void>;
}

const insertSourceCalendars = async <TCalendar extends InsertedSourceCalendar>(
  dependencies: SourceCalendarInsertDependencies<TCalendar>,
  userId: string,
  values: Record<string, unknown>[],
): Promise<TCalendar[]> => {
  if (values.length === EMPTY_LIST_COUNT) {
    return [];
  }

  const inserted = await dependencies.insertCalendars(
    values.map((value) => applySourceSyncDefaults(value)),
  );

  const feed = await dependencies.ensureDefaultFeed(userId);
  const memberships = inserted
    .filter(({ includeInIcalFeed }) => includeInIcalFeed)
    .map(({ id }) => ({ feedId: feed.id, calendarId: id }));

  if (memberships.length > EMPTY_LIST_COUNT) {
    await dependencies.insertFeedCalendars(memberships);
  }

  return inserted;
};

const createSourceCalendarInsertDependencies = (
  client: SourceCalendarClient,
): SourceCalendarInsertDependencies<typeof calendarsTable.$inferSelect> => ({
  insertCalendars: (values) =>
    client
      .insert(calendarsTable)
      .values(values as typeof calendarsTable.$inferInsert[])
      .returning(),
  ensureDefaultFeed: (userId) => ensureDefaultFeedForClient(client, userId),
  insertFeedCalendars: async (rows) => {
    await client.insert(icalFeedCalendarsTable).values(rows).onConflictDoNothing();
  },
});

export { createSourceCalendarInsertDependencies, insertSourceCalendars };
export type { InsertedSourceCalendar, SourceCalendarInsertDependencies };
