import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { createSnapshot } from "./create-snapshot";
import { syncSourceFromSnapshot } from "./sync-source-from-snapshot";
import type { Source } from "./sync-source-from-snapshot";

const fetchAndSyncSource = async (database: PostgresJsDatabase, source: Source): Promise<void> => {
  if (!source.url) {
    throw new Error(`Source ${source.id} is missing url`);
  }
  const { ical } = await pullRemoteCalendar("ical", source.url);
  await createSnapshot(database, source.id, ical);
  await syncSourceFromSnapshot(database, source);
};

export { fetchAndSyncSource };
