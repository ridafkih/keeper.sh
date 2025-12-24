import { log } from "@keeper.sh/log";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { createSnapshot } from "./create-snapshot";
import { syncSourceFromSnapshot, type Source } from "./sync-source-from-snapshot";

export async function fetchAndSyncSource(source: Source) {
  log.trace("fetchAndSyncSource for source '%s' started", source.id);

  try {
    const { ical } = await pullRemoteCalendar("ical", source.url);
    await createSnapshot(source.id, ical);
    await syncSourceFromSnapshot(source);
    log.trace("fetchAndSyncSource for source '%s' complete", source.id);
  } catch (error) {
    log.error(error, "failed to fetch and sync source '%s'", source.id);
    throw error;
  }
}
