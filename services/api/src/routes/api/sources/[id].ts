import {
  calendarAccountsTable,
  calendarsTable,
  sourceDestinationMappingsTable,
} from "@keeper.sh/database/schema";
import { and, eq, inArray } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { database, premiumService } from "@/context";
import { idParamSchema } from "@/utils/request-query";
import {
  getDestinationsForSource,
  getSourcesForDestination,
} from "@/utils/source-destination-mappings";
import { withProviderMetadata } from "@/utils/provider-display";
import { handlePatchSourceRoute } from "./[id]/source-item-routes";

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => {
    if (!params.id || !idParamSchema.allows(params)) {
      return ErrorResponse.badRequest("ID is required").toResponse();
    }
    const { id } = params;

    const [source] = await database
      .select({
        id: calendarsTable.id,
        name: calendarsTable.name,
        originalName: calendarsTable.originalName,
        calendarType: calendarsTable.calendarType,
        capabilities: calendarsTable.capabilities,
        provider: calendarAccountsTable.provider,
        url: calendarsTable.url,
        calendarUrl: calendarsTable.calendarUrl,
        customEventName: calendarsTable.customEventName,
        excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
        excludeEventDescription: calendarsTable.excludeEventDescription,
        excludeEventLocation: calendarsTable.excludeEventLocation,
        excludeEventName: calendarsTable.excludeEventName,
        excludeFocusTime: calendarsTable.excludeFocusTime,
        excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
        syncFutureRange: calendarsTable.syncFutureRange,
        syncHistoricRange: calendarsTable.syncHistoricRange,
        treatFullDayTimedEventsAsAllDay: calendarsTable.treatFullDayTimedEventsAsAllDay,
        createdAt: calendarsTable.createdAt,
        updatedAt: calendarsTable.updatedAt,
      })
      .from(calendarsTable)
      .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
      .where(
        and(
          eq(calendarsTable.id, id),
          eq(calendarsTable.userId, userId),
        ),
      )
      .limit(1);

    if (!source) {
      return ErrorResponse.notFound().toResponse();
    }

    const [destinationIds, sourceIds] = await Promise.all([
      getDestinationsForSource(userId, id),
      getSourcesForDestination(userId, id),
    ]);

    return Response.json({
      ...withProviderMetadata(source),
      destinationIds,
      sourceIds,
    });
  }),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();
    return handlePatchSourceRoute(
      { body: payload, params, userId },
      {
        canUseEventFilters: (candidateUserId) => premiumService.canUseEventFilters(candidateUserId),
        updateSource: (userIdToUpdate, sourceCalendarId, updates) =>
          database.transaction(async (transaction) => {
            const [updated] = await transaction
              .update(calendarsTable)
              .set(updates)
              .where(
                and(
                  eq(calendarsTable.id, sourceCalendarId),
                  eq(calendarsTable.userId, userIdToUpdate),
                ),
              )
              .returning();

            if (
              updated
              && ("syncHistoricRange" in updates || "syncFutureRange" in updates)
            ) {
              const mappedSources = await transaction
                .select({ id: sourceDestinationMappingsTable.sourceCalendarId })
                .from(sourceDestinationMappingsTable)
                .where(eq(
                  sourceDestinationMappingsTable.destinationCalendarId,
                  sourceCalendarId,
                ));
              const mappedSourceIds = mappedSources.map(({ id }) => id);
              if (mappedSourceIds.length > 0) {
                await transaction
                  .update(calendarsTable)
                  .set({ syncToken: null })
                  .where(inArray(calendarsTable.id, mappedSourceIds));
              }
            }

            return updated ?? null;
          }),
      },
    );
  }),
);

export { GET, PATCH };
