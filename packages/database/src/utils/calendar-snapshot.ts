import { calendarSnapshotsTable } from "../database/schema";
import { database } from "./database";

/**
 * @param ical The raw text dump of a valid iCal formatted string.
 */
export const insertCalendarSnapshot = (ical: string) => {
  const record: typeof calendarSnapshotsTable.$inferInsert = { ical };
  database.insert(calendarSnapshotsTable).values(record);
};
