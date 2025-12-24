import { database } from "@keeper.sh/database";
import { calendarSnapshotsTable } from "@keeper.sh/database/schema";
import { log } from "@keeper.sh/log";

export async function createSnapshot(sourceId: string, ical: string) {
  log.trace("createSnapshot for source '%s' started", sourceId);
  await database.insert(calendarSnapshotsTable).values({ sourceId, ical });
  log.trace("createSnapshot for source '%s' complete", sourceId);
}
