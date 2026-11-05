import { syncStatusTable, calendarsTable, sourceDestinationMappingsTable } from "@keeper.sh/database/schema";
import { createWebsocketHandler } from "@keeper.sh/broadcast";
import type { Socket } from "@keeper.sh/broadcast";
import { syncAggregateSchema } from "@keeper.sh/data-schemas";
import { and, eq, inArray, max } from "drizzle-orm";
import { MAPPING_SYNC_STATE_EVENT } from "@keeper.sh/calendar";
import {
  database,
  getCachedSyncAggregate,
  getCurrentSyncAggregate,
  readMappingSyncState,
} from "@/context";
import { resolveSyncAggregatePayload } from "./websocket-payload";
import { runSendInitialSyncStatus } from "./websocket-initial-status";
import { context, widelog } from "@/utils/logging";
import { labelFailure } from "@/utils/error-labelling";

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

const sendInitialMappingSyncState = async (userId: string, socket: Socket): Promise<void> => {
  socket.send(JSON.stringify({
    data: await readMappingSyncState(userId),
    event: MAPPING_SYNC_STATE_EVENT,
  }));
};

const baseWebsocketHandler = createWebsocketHandler({
  onConnect: async (userId, socket) => {
    await sendInitialSyncStatus(userId, socket);
    await sendInitialMappingSyncState(userId, socket);
  },
});

const runWebsocketBoundary = (
  socket: Socket,
  operationName: "websocket:open" | "websocket:close",
  callback: () => void | Promise<void>,
): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", operationName);
    widelog.set("operation.type", "connection");
    widelog.set("request.id", crypto.randomUUID());
    widelog.set("user.id", socket.data.userId);

    try {
      await widelog.time.measure("duration_ms", () => callback());
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("outcome", "error");
      labelFailure(error, { slug: "unclassified" });
      throw error;
    } finally {
      widelog.flush();
    }
  });

const websocketHandler = {
  close(socket: Socket) {
    return runWebsocketBoundary(socket, "websocket:close", () => {
      baseWebsocketHandler.close(socket);
    });
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
