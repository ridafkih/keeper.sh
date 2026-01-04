import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { pullRemoteCalendar } from "./pull-remote-calendar";
import { createSnapshot } from "./create-snapshot";
import {
  syncSourceFromSnapshot,
  type Source,
} from "./sync-source-from-snapshot";

export async function fetchAndSyncSource(
  database: BunSQLDatabase,
  source: Source,
) {
  const { ical } = await pullRemoteCalendar("ical", source.url);
  await createSnapshot(database, source.id, ical);
  await syncSourceFromSnapshot(database, source);
}
