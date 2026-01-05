import { calendarDestinationsTable, syncStatusTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import { withAuth, withTracing } from "../../../utils/middleware";
import { database } from "../../../context";

const GET = withTracing(
  withAuth(async ({ userId }) => {
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

    const destinations = statuses.map((status) => ({
      destinationId: status.destinationId,
      inSync: status.localEventCount === status.remoteEventCount,
      lastSyncedAt: status.lastSyncedAt,
      localEventCount: status.localEventCount,
      remoteEventCount: status.remoteEventCount,
    }));

    return Response.json({ destinations });
  }),
);

export { GET };
