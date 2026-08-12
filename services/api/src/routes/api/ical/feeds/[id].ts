import { HTTP_STATUS } from "@keeper.sh/constants";
import { icalFeedSettingsTable, icalFeedsTable } from "@keeper.sh/database/schema";
import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { and, eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService } from "@/context";
import { ErrorResponse } from "@/utils/responses";
import { icalFeedPatchBodySchema } from "@/utils/request-body";
import { icalFeedNameSchema } from "@keeper.sh/data-schemas";
import type { IcalFeedPatchBody } from "@/utils/request-body";
import {
  DefaultFeedDeletionError,
  FEED_ROW_COLUMNS,
  FeedNotFoundError,
  deleteFeed,
  findFeedForUser,
  resolveLegacyFeedIdentifier,
} from "@/utils/ical-feeds";
import { buildFeedUrl, withFeedUrl } from "@/utils/ical-feed-url";

const EMPTY_UPDATE_COUNT = 0;

const FEED_BOOLEAN_SETTING_FIELDS = [
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
  "excludeFocusTime",
  "excludeOutOfOffice",
] as const;

const LEGACY_MIRRORED_FIELDS = [
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
  "customEventName",
] as const;

type FeedUpdates = Record<string, string | boolean>;

const buildFeedUpdates = (body: IcalFeedPatchBody): FeedUpdates => {
  const settingUpdates = Object.fromEntries(
    FEED_BOOLEAN_SETTING_FIELDS
      .filter((field) => typeof body[field] === "boolean")
      .map((field) => [field, body[field] as boolean]),
  );

  return {
    ...(typeof body.name === "string" && { name: body.name.trim() }),
    ...settingUpdates,
    ...(typeof body.customEventName === "string" && { customEventName: body.customEventName }),
  };
};

const buildLegacyMirrorUpdates = (updates: FeedUpdates): FeedUpdates =>
  Object.fromEntries(
    LEGACY_MIRRORED_FIELDS
      .filter((field) => field in updates)
      .map((field) => [field, updates[field] as string | boolean]),
  );

const isCustomizationUpdate = (updates: FeedUpdates): boolean =>
  Object.keys(updates).some((field) => field !== "name");

interface PatchIcalFeedRouteContext {
  body: unknown;
  params: Record<string, string | undefined>;
  userId: string;
}

interface PatchIcalFeedDependencies<TFeed extends { isDefault: boolean }> {
  canCustomizeIcalFeed: (userId: string) => Promise<boolean>;
  findFeed: (userId: string, feedId: string) => Promise<TFeed | null>;
  updateFeed: (
    userId: string,
    feedId: string,
    updates: FeedUpdates,
  ) => Promise<TFeed | null>;
  mirrorLegacySettings: (userId: string, updates: FeedUpdates) => Promise<void>;
}

const handlePatchIcalFeedRoute = async <TFeed extends { isDefault: boolean }>(
  context: PatchIcalFeedRouteContext,
  dependencies: PatchIcalFeedDependencies<TFeed>,
): Promise<Response> => {
  const feedId = context.params.id;
  if (!feedId) {
    return ErrorResponse.badRequest("Feed ID is required.").toResponse();
  }

  if (!icalFeedPatchBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  const updates = buildFeedUpdates(context.body);
  if (Object.keys(updates).length === EMPTY_UPDATE_COUNT) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  if (typeof updates.name === "string" && !icalFeedNameSchema.allows(updates.name)) {
    return ErrorResponse.badRequest("Feed name cannot be empty.").toResponse();
  }

  if (isCustomizationUpdate(updates)) {
    const allowed = await dependencies.canCustomizeIcalFeed(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden("iCal feed customization requires a Pro plan.").toResponse();
    }
  }

  const feed = await dependencies.findFeed(context.userId, feedId);
  if (!feed) {
    return ErrorResponse.notFound("Feed not found.").toResponse();
  }

  const updated = await dependencies.updateFeed(context.userId, feedId, updates);
  if (!updated) {
    return ErrorResponse.notFound("Feed not found.").toResponse();
  }

  if (feed.isDefault) {
    const mirrored = buildLegacyMirrorUpdates(updates);
    if (Object.keys(mirrored).length > EMPTY_UPDATE_COUNT) {
      await dependencies.mirrorLegacySettings(context.userId, mirrored);
    }
  }

  return Response.json(updated);
};

interface LegacyAliasFeed {
  isDefault: boolean;
  legacyAlias: boolean;
}

interface GetIcalFeedDependencies<TFeed extends LegacyAliasFeed> {
  findFeed: (userId: string, feedId: string) => Promise<TFeed | null>;
  resolveLegacyUrl: (userId: string) => Promise<string>;
}

const handleGetIcalFeedRoute = async <TFeed extends LegacyAliasFeed>(
  context: { params: Record<string, string | undefined>; userId: string },
  dependencies: GetIcalFeedDependencies<TFeed>,
): Promise<Response> => {
  const feedId = context.params.id;
  if (!feedId) {
    return ErrorResponse.badRequest("Feed ID is required.").toResponse();
  }

  const feed = await dependencies.findFeed(context.userId, feedId);
  if (!feed) {
    return ErrorResponse.notFound("Feed not found.").toResponse();
  }

  if (!feed.isDefault || !feed.legacyAlias) {
    return Response.json(feed);
  }

  const legacyIcalUrl = await dependencies.resolveLegacyUrl(context.userId);
  return Response.json({ ...feed, legacyIcalUrl });
};

interface DeleteIcalFeedDependencies {
  deleteFeed: (userId: string, feedId: string) => Promise<void>;
}

const handleDeleteIcalFeedRoute = async (
  context: { params: Record<string, string | undefined>; userId: string },
  dependencies: DeleteIcalFeedDependencies,
): Promise<Response> => {
  const feedId = context.params.id;
  if (!feedId) {
    return ErrorResponse.badRequest("Feed ID is required.").toResponse();
  }

  try {
    await dependencies.deleteFeed(context.userId, feedId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    if (error instanceof DefaultFeedDeletionError) {
      return ErrorResponse.conflict(error.message).toResponse();
    }
    if (error instanceof FeedNotFoundError) {
      return ErrorResponse.notFound(error.message).toResponse();
    }
    throw error;
  }
};

const GET = withWideEvent(
  withAuth(async ({ params, userId }) => await handleGetIcalFeedRoute(
    { params, userId },
    {
      findFeed: async (resolvedUserId, resolvedFeedId) => {
        const feed = await findFeedForUser(database, resolvedUserId, resolvedFeedId);
        if (!feed) {
          return null;
        }
        return withFeedUrl(feed);
      },
      resolveLegacyUrl: async (resolvedUserId) =>
        buildFeedUrl(await resolveLegacyFeedIdentifier(database, resolvedUserId)),
    },
  )),
);

const PATCH = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    const payload = await request.json();

    return await handlePatchIcalFeedRoute(
      { body: payload, params, userId },
      {
        canCustomizeIcalFeed: (resolvedUserId) =>
          premiumService.canCustomizeIcalFeed(resolvedUserId),
        findFeed: (resolvedUserId, resolvedFeedId) =>
          findFeedForUser(database, resolvedUserId, resolvedFeedId),
        updateFeed: async (resolvedUserId, resolvedFeedId, updates) => {
          const [updated] = await database
            .update(icalFeedsTable)
            .set(updates)
            .where(
              and(
                eq(icalFeedsTable.id, resolvedFeedId),
                eq(icalFeedsTable.userId, resolvedUserId),
              ),
            )
            .returning(FEED_ROW_COLUMNS);

          return updated ?? null;
        },
        mirrorLegacySettings: async (resolvedUserId, updates) => {
          await database
            .insert(icalFeedSettingsTable)
            .values({
              userId: resolvedUserId,
              includeEventName: DEFAULT_FEED_SETTINGS.includeEventName,
              includeEventDescription: DEFAULT_FEED_SETTINGS.includeEventDescription,
              includeEventLocation: DEFAULT_FEED_SETTINGS.includeEventLocation,
              excludeAllDayEvents: DEFAULT_FEED_SETTINGS.excludeAllDayEvents,
              customEventName: DEFAULT_FEED_SETTINGS.customEventName,
              ...updates,
            })
            .onConflictDoUpdate({
              target: icalFeedSettingsTable.userId,
              set: updates,
            });
        },
      },
    );
  }),
);

const DELETE = withWideEvent(
  withAuth(async ({ params, userId }) =>
    await handleDeleteIcalFeedRoute({ params, userId }, { deleteFeed })),
);

export {
  DELETE,
  GET,
  PATCH,
  handleDeleteIcalFeedRoute,
  handleGetIcalFeedRoute,
  handlePatchIcalFeedRoute,
};
