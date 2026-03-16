import { syncStatusTable, calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { createWebsocketHandler } from "@keeper.sh/broadcast";
import type { Socket } from "@keeper.sh/broadcast";
import { syncAggregateSchema } from "@keeper.sh/data-schemas";
import { and, eq, inArray, max } from "drizzle-orm";
import { database, getCachedSyncAggregate, getCurrentSyncAggregate } from "@/context";
import { resolveSyncAggregatePayload } from "./websocket-payload";
import { runSendInitialSyncStatus } from "./websocket-initial-status";

const selectLatestDestinationSyncedAt = async (userId: string): Promise<Date | null> => {
  const [aggregate] = await database
    .select({
      lastSyncedAt: max(syncStatusTable.lastSyncedAt),
    })
    .from(syncStatusTable)
    .innerJoin(
      calendarsTable,
      eq(syncStatusTable.calendarId, calendarsTable.id),
    )
    .where(
      and(
        eq(calendarsTable.userId, userId),
        inArray(calendarsTable.id,
          database.selectDistinct({ id: sourceDestinationMappingsTable.destinationCalendarId })
            .from(sourceDestinationMappingsTable)
        ),
      ),
    );

  return aggregate?.lastSyncedAt ?? null;
};

const sendInitialSyncStatus = (userId: string, socket: Socket): Promise<void> =>
  runSendInitialSyncStatus(userId, socket, {
    isValidSyncAggregate: syncAggregateSchema.allows,
    resolveSyncAggregatePayload: (userIdToResolve, fallback) =>
      resolveSyncAggregatePayload(userIdToResolve, fallback, {
        getCachedSyncAggregate,
        getCurrentSyncAggregate,
        isValidSyncAggregate: syncAggregateSchema.allows,
      }),
    selectLatestDestinationSyncedAt,
  });

const baseWebsocketHandler = createWebsocketHandler({
  onConnect: sendInitialSyncStatus,
});

const runWebsocketBoundary = async (
  _socket: Socket,
  _operationName: "websocket:open" | "websocket:close",
  callback: () => void | Promise<void>,
): Promise<void> => {
  await callback();
};

const websocketHandler = {
  close(socket: Socket): void {
    runWebsocketBoundary(socket, "websocket:close", () => {
      baseWebsocketHandler.close(socket);
    }).catch(() => null);
  },
  idleTimeout: baseWebsocketHandler.idleTimeout,
  message: baseWebsocketHandler.message,
  open(socket: Socket): Promise<void> {
    return runWebsocketBoundary(socket, "websocket:open", () =>
      baseWebsocketHandler.open(socket),
    );
  },
};

export { websocketHandler };
