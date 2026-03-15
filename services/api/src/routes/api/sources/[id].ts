import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { database, premiumService } from "../../../context";
import { triggerDestinationSync } from "../../../utils/sync";
import { idParamSchema } from "../../../utils/request-query";
import {
  getDestinationsForSource,
  getSourcesForDestination,
} from "../../../utils/source-destination-mappings";
import { withProviderMetadata } from "../../../utils/provider-display";
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
        excludeWorkingLocation: calendarsTable.excludeWorkingLocation,
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
        triggerDestinationSync,
        updateSource: async (userIdToUpdate, sourceCalendarId, updates) => {
          const [updated] = await database
            .update(calendarsTable)
            .set(updates)
            .where(
              and(
                eq(calendarsTable.id, sourceCalendarId),
                eq(calendarsTable.userId, userIdToUpdate),
              ),
            )
            .returning();

          return updated ?? null;
        },
      },
    );
  }),
);

export { GET, PATCH };
