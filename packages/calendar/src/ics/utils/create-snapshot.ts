import { calendarSnapshotsTable, calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { CalendarSnapshotChange } from "../../core/sync-engine/ingest";
import { resolveRefreshedFeedNames } from "./feed-name";

const computeContentHash = async (content: string): Promise<string> => {
  const encoded = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = new Uint8Array(hashBuffer);

  const hexParts: string[] = [];
  for (const byte of hashArray) {
    hexParts.push(byte.toString(16).padStart(2, "0"));
  }

  return hexParts.join("");
};

interface PrepareSnapshotResult {
  changed: boolean;
  snapshot?: CalendarSnapshotChange;
}

const prepareCalendarSnapshotChange = async (
  ical: string,
  calendarExists: boolean,
  existingContentHash?: string | null,
): Promise<PrepareSnapshotResult> => {
  if (!calendarExists) {
    return { changed: false };
  }
  const contentHash = await computeContentHash(ical);
  if (existingContentHash === contentHash) {
    return { changed: false };
  }
  return {
    changed: true,
    snapshot: { ical, contentHash },
  };
};

const prepareCalendarSnapshot = async (
  database: BunSQLDatabase,
  calendarId: string,
  ical: string,
): Promise<PrepareSnapshotResult> => {
  const [calendar] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId));

  if (!calendar) {
    return prepareCalendarSnapshotChange(ical, false);
  }

  const [existing] = await database
    .select({ contentHash: calendarSnapshotsTable.contentHash })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.calendarId, calendarId));

  return prepareCalendarSnapshotChange(ical, true, existing?.contentHash);
};

type SnapshotWriter = Pick<BunSQLDatabase, "insert" | "select" | "update">;

const followFeedName = async (
  database: SnapshotWriter,
  calendarId: string,
  ical: string,
): Promise<void> => {
  const [stored] = await database
    .select({
      name: calendarsTable.name,
      originalName: calendarsTable.originalName,
      url: calendarsTable.url,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId));

  if (!stored) {
    return;
  }

  const refreshed = resolveRefreshedFeedNames(stored, ical);
  if (!refreshed) {
    return;
  }

  await database
    .update(calendarsTable)
    .set(refreshed)
    .where(eq(calendarsTable.id, calendarId));
};

const persistCalendarSnapshot = async (
  database: SnapshotWriter,
  calendarId: string,
  snapshot: CalendarSnapshotChange,
): Promise<void> => {
  await database
    .insert(calendarSnapshotsTable)
    .values({
      calendarId,
      contentHash: snapshot.contentHash,
      ical: snapshot.ical,
    })
    .onConflictDoUpdate({
      target: calendarSnapshotsTable.calendarId,
      set: {
        contentHash: snapshot.contentHash,
        createdAt: new Date(),
        ical: snapshot.ical,
      },
    });

  await followFeedName(database, calendarId, snapshot.ical);
};

export {
  persistCalendarSnapshot,
  prepareCalendarSnapshot,
  prepareCalendarSnapshotChange,
};
