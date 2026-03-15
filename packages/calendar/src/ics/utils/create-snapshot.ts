import { calendarSnapshotsTable, calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const createSnapshot = async (
  database: BunSQLDatabase,
  calendarId: string,
  ical: string,
): Promise<void> => {
  const [calendar] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId));

  if (!calendar) {
    return;
  }

  await database.insert(calendarSnapshotsTable).values({ ical, calendarId });
};

export { createSnapshot };
