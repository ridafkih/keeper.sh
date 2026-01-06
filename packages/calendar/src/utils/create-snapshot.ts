import { calendarSnapshotsTable, calendarSourcesTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const createSnapshot = async (
  database: BunSQLDatabase,
  sourceId: string,
  ical: string,
): Promise<void> => {
  const [source] = await database
    .select({ id: calendarSourcesTable.id })
    .from(calendarSourcesTable)
    .where(eq(calendarSourcesTable.id, sourceId));

  if (!source) {
    return;
  }

  await database.insert(calendarSnapshotsTable).values({ ical, sourceId });
};

export { createSnapshot };
