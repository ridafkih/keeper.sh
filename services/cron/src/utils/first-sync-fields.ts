import { calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { sql } from "drizzle-orm";
import { widelog } from "@/utils/logging";

const pendingFirstSyncMappingCount = sql<number>`(
  select count(*) from ${sourceDestinationMappingsTable}
  where ${sourceDestinationMappingsTable.sourceCalendarId} = ${calendarsTable.id}
    and ${sourceDestinationMappingsTable.firstSyncedAt} is null
)`.mapWith(Number);

const recordPendingFirstSyncs = (pendingMappingCount: number): void => {
  if (pendingMappingCount > 0) {
    widelog.set("first_sync.pending_mapping_count", pendingMappingCount);
  }
};

export { pendingFirstSyncMappingCount, recordPendingFirstSyncs };
