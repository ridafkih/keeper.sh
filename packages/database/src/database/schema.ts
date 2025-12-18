import { text, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

export const calendarSnapshotsTable = pgTable("calendar_snapshots", {
  id: uuid().notNull().primaryKey().defaultRandom(),
  createdAt: timestamp().notNull().defaultNow(),
  ical: text(),
});
