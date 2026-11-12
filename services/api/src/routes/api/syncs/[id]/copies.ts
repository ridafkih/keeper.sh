import { and, desc, eq, inArray } from "drizzle-orm";
import { eventMappingsTable, eventStatesTable } from "@keeper.sh/database/schema";
import type { SyncDefinition } from "@keeper.sh/data-schemas";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { clampPageSize, findSyncForUser } from "@/utils/syncs";
import { readLimit } from "@/handlers/sync-routes";
import { database } from "@/context";

interface SyncCopy {
  destinationCalendarId: string;
  endTime: string;
  id: string;
  isAllDay: boolean;
  sourceCalendarId: string;
  startTime: string;
  title: string | null;
}

interface SyncCopiesDependencies {
  findSync: (userId: string, syncId: string) => Promise<SyncDefinition | null>;
  listCopies: (destinationIds: string[], sourceIds: string[], limit: number) => Promise<SyncCopy[]>;
}

// The copies a sync has made most recently, for watching its first run land.
const handleSyncCopiesRoute = async (
  { limit, syncId, userId }: { limit: string | null; syncId: string | undefined; userId: string },
  dependencies: SyncCopiesDependencies,
): Promise<Response> => {
  if (!syncId) {
    return ErrorResponse.badRequest("Sync id is required").toResponse();
  }
  const sync = await dependencies.findSync(userId, syncId);
  if (!sync) {
    return ErrorResponse.notFound("Sync not found").toResponse();
  }
  let destinationIds = sync.destinationCalendarIds;
  let sourceIds = sync.sourceCalendarIds;
  if (sync.mode === "both_ways") {
    destinationIds = sync.memberCalendarIds;
    sourceIds = sync.memberCalendarIds;
  }
  if (destinationIds.length === 0 || sourceIds.length === 0) {
    return Response.json({ copies: [] });
  }
  const copies = await dependencies.listCopies(destinationIds, sourceIds, clampPageSize(readLimit(limit)));
  return Response.json({ copies: copies.filter((copy) => copy.sourceCalendarId !== copy.destinationCalendarId) });
};

const GET = withWideEvent(
  withAuth(({ params, request, userId }) => handleSyncCopiesRoute(
    { limit: new URL(request.url).searchParams.get("limit"), syncId: params.id, userId },
    {
      findSync: (resolvedUserId, syncId) => findSyncForUser(database, resolvedUserId, syncId),
      listCopies: async (destinationIds, sourceIds, limit) => {
        const rows = await database
          .select({
            destinationCalendarId: eventMappingsTable.calendarId,
            endTime: eventMappingsTable.endTime,
            id: eventMappingsTable.id,
            isAllDay: eventStatesTable.isAllDay,
            sourceCalendarId: eventMappingsTable.sourceCalendarId,
            startTime: eventMappingsTable.startTime,
            title: eventStatesTable.title,
          })
          .from(eventMappingsTable)
          .leftJoin(eventStatesTable, eq(eventMappingsTable.eventStateId, eventStatesTable.id))
          .where(and(
            inArray(eventMappingsTable.calendarId, destinationIds),
            inArray(eventMappingsTable.sourceCalendarId, sourceIds),
          ))
          .orderBy(desc(eventMappingsTable.createdAt), desc(eventMappingsTable.id))
          .limit(limit);
        return rows.map((row) => ({
          destinationCalendarId: row.destinationCalendarId,
          endTime: row.endTime.toISOString(),
          id: row.id,
          isAllDay: row.isAllDay ?? false,
          sourceCalendarId: row.sourceCalendarId ?? "",
          startTime: row.startTime.toISOString(),
          title: row.title,
        }));
      },
    },
  )),
);

export { GET, handleSyncCopiesRoute };
export type { SyncCopiesDependencies, SyncCopy };
