import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { createSnapshot } from "./create-snapshot";
import { syncSourceFromSnapshot } from "./sync-source-from-snapshot";
import type { Source } from "./sync-source-from-snapshot";

const fetchAndSyncSource = async (database: BunSQLDatabase, source: Source): Promise<void> => {
  const { ical } = await pullRemoteCalendar("ical", source.url);
  await createSnapshot(database, source.id, ical);
  await syncSourceFromSnapshot(database, source);
};

export { fetchAndSyncSource };
