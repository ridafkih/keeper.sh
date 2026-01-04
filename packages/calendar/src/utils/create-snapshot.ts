import { calendarSnapshotsTable, remoteICalSourcesTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

export async function createSnapshot(
  database: BunSQLDatabase,
  sourceId: string,
  ical: string,
) {
  const [source] = await database
    .select({ id: remoteICalSourcesTable.id })
    .from(remoteICalSourcesTable)
    .where(eq(remoteICalSourcesTable.id, sourceId));

  if (!source) {
    return;
  }

  await database.insert(calendarSnapshotsTable).values({ sourceId, ical });
}
