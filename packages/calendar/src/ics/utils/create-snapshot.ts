import { calendarSnapshotsTable, calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

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

interface CreateSnapshotResult {
  changed: boolean;
}

const createSnapshot = async (
  database: BunSQLDatabase,
  calendarId: string,
  ical: string,
): Promise<CreateSnapshotResult> => {
  const [calendar] = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId));

  if (!calendar) {
    return { changed: false };
  }

  const contentHash = await computeContentHash(ical);

  const [existing] = await database
    .select({ contentHash: calendarSnapshotsTable.contentHash })
    .from(calendarSnapshotsTable)
    .where(eq(calendarSnapshotsTable.calendarId, calendarId));

  if (existing && existing.contentHash === contentHash) {
    return { changed: false };
  }

  await database
    .insert(calendarSnapshotsTable)
    .values({ ical, calendarId, contentHash })
    .onConflictDoUpdate({
      target: calendarSnapshotsTable.calendarId,
      set: { ical, contentHash, createdAt: new Date() },
    });

  return { changed: true };
};

export { createSnapshot };
