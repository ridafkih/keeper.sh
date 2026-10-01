import { and, eq, inArray } from "drizzle-orm";
import { calendarsTable } from "@keeper.sh/database/schema";
import { createSyncBodySchema, syncRangeSchema } from "@keeper.sh/data-schemas";
import { getConfigurableSyncWindow, getEventsForCalendarsWithDiagnostics } from "@keeper.sh/calendar";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { EMPTY_SYNC_DEFINITION, mergeSyncDefinition } from "@/utils/syncs";
import { estimateSyncCopies } from "@/utils/sync-estimate";
import type { EstimateCalendar, SyncEstimateDependencies } from "@/utils/sync-estimate";
import { database } from "@/context";

interface EstimateRouteDependencies extends SyncEstimateDependencies {
  findCalendars: (userId: string, calendarIds: string[]) => Promise<EstimateCalendar[]>;
}

const handleSyncEstimateRoute = async (
  { body, userId }: { body: unknown; userId: string },
  dependencies: EstimateRouteDependencies,
): Promise<Response> => {
  if (!createSyncBodySchema.allows(body)) {
    return ErrorResponse.badRequest("Invalid sync").toResponse();
  }
  const definition = mergeSyncDefinition(EMPTY_SYNC_DEFINITION, body);
  const calendarIds = [
    ...new Set([...definition.sourceCalendarIds, ...definition.destinationCalendarIds, ...definition.memberCalendarIds]),
  ];
  const calendars = await dependencies.findCalendars(userId, calendarIds);
  if (calendars.length !== calendarIds.length) {
    return ErrorResponse.notFound("Calendar not found").toResponse();
  }
  const estimate = await estimateSyncCopies(
    definition,
    new Map(calendars.map((calendar) => [calendar.id, calendar])),
    dependencies,
  );
  return Response.json(estimate);
};

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json().catch(() => null);
    return handleSyncEstimateRoute({ body, userId }, {
      countCopies: async (sourceCalendarIds, window, rules) => {
        const { events } = await getEventsForCalendarsWithDiagnostics(database, sourceCalendarIds, window, {
          rulesBySourceCalendarId: new Map(sourceCalendarIds.map((id) => [id, rules])),
        });
        return events.map((event) => event.startTime);
      },
      findCalendars: async (resolvedUserId, calendarIds) => {
        if (calendarIds.length === 0) {
          return [];
        }
        const rows = await database
          .select({
            id: calendarsTable.id,
            syncFutureRange: calendarsTable.syncFutureRange,
            syncHistoricRange: calendarsTable.syncHistoricRange,
          })
          .from(calendarsTable)
          .where(and(eq(calendarsTable.userId, resolvedUserId), inArray(calendarsTable.id, calendarIds)));
        return rows.map((row) => ({
          id: row.id,
          syncFutureRange: syncRangeSchema.assert(row.syncFutureRange),
          syncHistoricRange: syncRangeSchema.assert(row.syncHistoricRange),
        }));
      },
      resolveWindow: (historicRange, futureRange, now) => getConfigurableSyncWindow(historicRange, futureRange, now),
    });
  }),
);

export { POST, handleSyncEstimateRoute };
export type { EstimateRouteDependencies };
