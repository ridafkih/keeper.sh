import {
  calendarsTable,
  sourceDestinationMappingsTable,
  syncStatusTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { KeeperDatabase, KeeperSyncStatus } from "../types";

const toIsoString = (value: Date | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  return value.toISOString();
};

const getSyncStatuses = async (database: KeeperDatabase, userId: string): Promise<KeeperSyncStatus[]> => {
  const statuses = await database
    .select({
      calendarId: syncStatusTable.calendarId,
      lastSyncedAt: syncStatusTable.lastSyncedAt,
      localEventCount: syncStatusTable.localEventCount,
      remoteEventCount: syncStatusTable.remoteEventCount,
    })
    .from(syncStatusTable)
    .innerJoin(calendarsTable, eq(syncStatusTable.calendarId, calendarsTable.id))
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(
          calendarsTable.id,
          database
            .selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable),
        ),
      ),
    );

  return statuses.map((status) => ({
    calendarId: status.calendarId,
    inSync: status.localEventCount === status.remoteEventCount,
    lastSyncedAt: toIsoString(status.lastSyncedAt),
    localEventCount: status.localEventCount,
    remoteEventCount: status.remoteEventCount,
  }));
};

export { getSyncStatuses };
