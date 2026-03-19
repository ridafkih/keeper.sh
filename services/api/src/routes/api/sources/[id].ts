import { calendarAccountsTable, calendarsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
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
import { ensureSettingsSnapshot, reconcileSourceSettings, isUserPending, broadcastPendingAggregate } from "@/utils/sync-pending";
import { redis, broadcastService } from "@/context";

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

const NON_SYNC_AFFECTING_FIELDS = new Set(["includeInIcalFeed", "name"]);

const readCurrentSyncFields = async (
  userId: string,
  calendarId: string,
): Promise<Record<string, unknown> | null> => {
  const [current] = await database
    .select({
      customEventName: calendarsTable.customEventName,
      excludeAllDayEvents: calendarsTable.excludeAllDayEvents,
      excludeEventDescription: calendarsTable.excludeEventDescription,
      excludeEventLocation: calendarsTable.excludeEventLocation,
      excludeEventName: calendarsTable.excludeEventName,
      excludeFocusTime: calendarsTable.excludeFocusTime,
      excludeOutOfOffice: calendarsTable.excludeOutOfOffice,
      excludeWorkingLocation: calendarsTable.excludeWorkingLocation,
    })
    .from(calendarsTable)
    .where(and(eq(calendarsTable.id, calendarId), eq(calendarsTable.userId, userId)))
    .limit(1);

  return current ?? null;
};

const hasSyncAffectingPayload = (
  calendarId: string | undefined,
  payload: unknown,
): calendarId is string => {
  if (!calendarId) {
    return false;
  }
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  return Object.keys(payload).some((key) => !NON_SYNC_AFFECTING_FIELDS.has(key));
};

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const payload = await request.json();

    let preUpdateSettings: Record<string, unknown> | null = null;
    if (hasSyncAffectingPayload(params.id, payload)) {
      preUpdateSettings = await readCurrentSyncFields(userId, params.id);
    }

    const response = await handlePatchSourceRoute(
      { body: payload, params, userId },
      {
        canUseEventFilters: (candidateUserId) => premiumService.canUseEventFilters(candidateUserId),
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

    if (response.ok && params.id && preUpdateSettings) {
      await ensureSettingsSnapshot(redis, params.id, preUpdateSettings);

      const postUpdateSettings = await readCurrentSyncFields(userId, params.id);
      if (postUpdateSettings) {
        await reconcileSourceSettings(redis, userId, params.id, postUpdateSettings);
        const pending = await isUserPending(redis, userId);
        await broadcastPendingAggregate(redis, broadcastService.emit, userId, pending);
      }
    }

    return response;
  }),
);

export { GET, PATCH };
