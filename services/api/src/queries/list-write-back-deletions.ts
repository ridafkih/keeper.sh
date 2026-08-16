import { calendarsTable, eventWriteBackTombstonesTable } from "@keeper.sh/database/schema";
import { aliasedTable, and, desc, eq, gt, ne } from "drizzle-orm";
import type { KeeperDatabase } from "@/types";

/*
 * The record is promised for 30 days, and the daily deletion cap lets a single two-way pair
 * write 50 tombstones a day, so a handful of pairs clears several thousand rows inside the
 * window with nothing wrong. The ceiling is only a guard against an unbounded read, and when
 * it is reached the caller is told, because a deletion silently missing from this list reads
 * as a deletion that never happened.
 */
const DELETION_RECORD_LIMIT = 5000;
const ABANDONED_TOMBSTONE_STATE = "abandoned";
const APPLIED_TOMBSTONE_STATE = "applied";

interface WriteBackDeletionRow {
  appliedAt: Date;
  destinationCalendarName: string | null;
  expiresAt: Date;
  id: string;
  snapshot: unknown;
  sourceCalendarName: string | null;
  state: string;
}

interface WriteBackDeletionRecord {
  confirmed: boolean;
  deletedAt: string;
  description: string | null;
  destinationCalendarName: string | null;
  endTime: string | null;
  expiresAt: string;
  id: string;
  isAllDay: boolean;
  location: string | null;
  sourceCalendarName: string | null;
  startTime: string | null;
  startTimeZone: string | null;
  title: string | null;
}

interface WriteBackDeletionListing {
  deletions: WriteBackDeletionRecord[];
  truncated: boolean;
}

const readText = (snapshot: Record<string, unknown>, key: string): string | null => {
  const value = snapshot[key];
  if (typeof value === "string") {
    return value;
  }
  return null;
};

const readInstant = (snapshot: Record<string, unknown>, key: string): string | null => {
  const value = snapshot[key];
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const asRecord = (snapshot: unknown): Record<string, unknown> => {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    return {};
  }
  return snapshot as Record<string, unknown>;
};

const toWriteBackDeletionRecord = (row: WriteBackDeletionRow): WriteBackDeletionRecord => {
  const snapshot = asRecord(row.snapshot);

  return {
    confirmed: row.state === APPLIED_TOMBSTONE_STATE,
    deletedAt: row.appliedAt.toISOString(),
    description: readText(snapshot, "description"),
    destinationCalendarName: row.destinationCalendarName,
    endTime: readInstant(snapshot, "endTime"),
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    isAllDay: snapshot.isAllDay === true,
    location: readText(snapshot, "location"),
    sourceCalendarName: row.sourceCalendarName,
    startTime: readInstant(snapshot, "startTime"),
    startTimeZone: readText(snapshot, "startTimeZone"),
    title: readText(snapshot, "title"),
  };
};

/*
 * Both places the product asks a user to authorize destroying real events promise a record
 * of what was deleted for 30 days. This is the half of that promise the user can read: the
 * snapshot taken before the original was destroyed, named against the calendars it moved
 * between, for as long as the retention window holds it.
 *
 * A record whose deletion was abandoned describes an original that is still there, so it is
 * not a deletion and is left out. A record still pending describes a deletion the provider
 * was asked for and that no pass has since abandoned — it is listed, marked unconfirmed,
 * because a real deletion missing from the record is the failure this list exists to
 * prevent.
 */
const listWriteBackDeletions = async (
  database: KeeperDatabase,
  userId: string,
  now: Date,
): Promise<WriteBackDeletionListing> => {
  const sourceCalendars = aliasedTable(calendarsTable, "source_calendars");
  const destinationCalendars = aliasedTable(calendarsTable, "destination_calendars");

  const rows = await database
    .select({
      appliedAt: eventWriteBackTombstonesTable.appliedAt,
      destinationCalendarName: destinationCalendars.name,
      expiresAt: eventWriteBackTombstonesTable.expiresAt,
      id: eventWriteBackTombstonesTable.id,
      snapshot: eventWriteBackTombstonesTable.snapshot,
      sourceCalendarName: sourceCalendars.name,
      state: eventWriteBackTombstonesTable.state,
    })
    .from(eventWriteBackTombstonesTable)
    .leftJoin(
      sourceCalendars,
      eq(sourceCalendars.id, eventWriteBackTombstonesTable.sourceCalendarId),
    )
    .leftJoin(
      destinationCalendars,
      eq(destinationCalendars.id, eventWriteBackTombstonesTable.destinationCalendarId),
    )
    .where(
      and(
        eq(eventWriteBackTombstonesTable.userId, userId),
        ne(eventWriteBackTombstonesTable.state, ABANDONED_TOMBSTONE_STATE),
        gt(eventWriteBackTombstonesTable.expiresAt, now),
      ),
    )
    .orderBy(desc(eventWriteBackTombstonesTable.appliedAt))
    .limit(DELETION_RECORD_LIMIT + 1);

  const listed = rows.slice(0, DELETION_RECORD_LIMIT);

  return {
    deletions: listed.map((row) => toWriteBackDeletionRecord(row)),
    truncated: rows.length > DELETION_RECORD_LIMIT,
  };
};

export { DELETION_RECORD_LIMIT, listWriteBackDeletions, toWriteBackDeletionRecord };
export type { WriteBackDeletionListing, WriteBackDeletionRecord, WriteBackDeletionRow };
