import { syncStatusTable, calendarDestinationsTable } from "@keeper.sh/database/schema";
import { createWebsocketHandler } from "@keeper.sh/broadcast";
import type { Socket } from "@keeper.sh/broadcast";
import { eq } from "drizzle-orm";
import { database } from "../context";

const sendInitialSyncStatus = async (userId: string, socket: Socket): Promise<void> => {
  const statuses = await database
    .select({
      destinationId: syncStatusTable.destinationId,
      lastSyncedAt: syncStatusTable.lastSyncedAt,
      localEventCount: syncStatusTable.localEventCount,
      remoteEventCount: syncStatusTable.remoteEventCount,
    })
    .from(syncStatusTable)
    .innerJoin(
      calendarDestinationsTable,
      eq(syncStatusTable.destinationId, calendarDestinationsTable.id),
    )
    .where(eq(calendarDestinationsTable.userId, userId));

  for (const status of statuses) {
    socket.send(
      JSON.stringify({
        data: {
          destinationId: status.destinationId,
          inSync: status.localEventCount === status.remoteEventCount,
          lastSyncedAt: status.lastSyncedAt?.toISOString(),
          localEventCount: status.localEventCount,
          remoteEventCount: status.remoteEventCount,
          status: "idle",
        },
        event: "sync:status",
      }),
    );
  }
};

const websocketHandler = createWebsocketHandler({
  onConnect: sendInitialSyncStatus,
});

export { websocketHandler };
