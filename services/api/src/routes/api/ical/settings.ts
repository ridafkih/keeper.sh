import { eq } from "drizzle-orm";
import { icalFeedSettingsTable, icalFeedsTable } from "@keeper.sh/database/schema";
import { DEFAULT_FEED_SETTINGS } from "@keeper.sh/data-schemas";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { database, premiumService } from "@/context";
import { ensureDefaultFeedForClient } from "@/utils/ical-feeds";
import {
  icalSettingsPatchBodySchema,
  type IcalSettingsPatchBody,
} from "@/utils/request-body";

const DEFAULT_SETTINGS = {
  includeEventName: DEFAULT_FEED_SETTINGS.includeEventName,
  includeEventDescription: DEFAULT_FEED_SETTINGS.includeEventDescription,
  includeEventLocation: DEFAULT_FEED_SETTINGS.includeEventLocation,
  excludeAllDayEvents: DEFAULT_FEED_SETTINGS.excludeAllDayEvents,
  customEventName: DEFAULT_FEED_SETTINGS.customEventName,
};

const ICAL_BOOLEAN_UPDATE_FIELDS = [
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
] as const;

const LEGACY_SETTINGS_COLUMNS = {
  userId: icalFeedsTable.userId,
  includeEventName: icalFeedsTable.includeEventName,
  includeEventDescription: icalFeedsTable.includeEventDescription,
  includeEventLocation: icalFeedsTable.includeEventLocation,
  excludeAllDayEvents: icalFeedsTable.excludeAllDayEvents,
  customEventName: icalFeedsTable.customEventName,
};

const buildIcalSettingsUpdates = (
  body: IcalSettingsPatchBody,
): Record<string, string | boolean> => {
  const updates: Record<string, string | boolean> = {};

  for (const field of ICAL_BOOLEAN_UPDATE_FIELDS) {
    if (typeof body[field] === "boolean") {
      updates[field] = body[field];
    }
  }
  if (typeof body.customEventName === "string") {
    updates.customEventName = body.customEventName;
  }

  return updates;
};

interface PatchIcalSettingsRouteContext {
  body: unknown;
  userId: string;
}

interface PatchIcalSettingsDependencies {
  canCustomizeIcalFeed: (userId: string) => Promise<boolean>;
  ensureDefaultFeed: (userId: string) => Promise<{ id: string }>;
  updateFeedSettings: (
    feedId: string,
    updates: Record<string, string | boolean>,
  ) => Promise<Record<string, unknown> | null>;
  upsertSettings: (
    userId: string,
    updates: Record<string, string | boolean>,
  ) => Promise<Record<string, unknown> | null>;
}

const handlePatchIcalSettingsRoute = async (
  context: PatchIcalSettingsRouteContext,
  dependencies: PatchIcalSettingsDependencies,
): Promise<Response> => {
  const { body: payload, userId } = context;
  let body: IcalSettingsPatchBody = {};
  if (icalSettingsPatchBodySchema.allows(payload)) {
    body = payload;
  }
  const updates = buildIcalSettingsUpdates(body);

  if (Object.keys(updates).length === 0) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  const allowed = await dependencies.canCustomizeIcalFeed(userId);
  if (!allowed) {
    return ErrorResponse.forbidden("iCal feed customization requires a Pro plan.").toResponse();
  }

  const feed = await dependencies.ensureDefaultFeed(userId);
  const updated = await dependencies.updateFeedSettings(feed.id, updates);
  await dependencies.upsertSettings(userId, updates);

  return Response.json(updated);
};

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const feed = await ensureDefaultFeedForClient(database, userId);

    const [settings] = await database
      .select(LEGACY_SETTINGS_COLUMNS)
      .from(icalFeedsTable)
      .where(eq(icalFeedsTable.id, feed.id))
      .limit(1);

    if (!settings) {
      throw new Error("Failed to resolve default iCal feed settings");
    }

    return Response.json(settings);
  }),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const payload = await request.json();
    return handlePatchIcalSettingsRoute(
      { body: payload, userId },
      {
        canCustomizeIcalFeed: (resolvedUserId) => premiumService.canCustomizeIcalFeed(resolvedUserId),
        ensureDefaultFeed: (resolvedUserId) =>
          ensureDefaultFeedForClient(database, resolvedUserId),
        updateFeedSettings: async (feedId, updates) => {
          const [updated] = await database
            .update(icalFeedsTable)
            .set(updates)
            .where(eq(icalFeedsTable.id, feedId))
            .returning(LEGACY_SETTINGS_COLUMNS);

          return updated ?? null;
        },
        upsertSettings: async (resolvedUserId, updates) => {
          const [updated] = await database
            .insert(icalFeedSettingsTable)
            .values({ userId: resolvedUserId, ...DEFAULT_SETTINGS, ...updates })
            .onConflictDoUpdate({
              target: icalFeedSettingsTable.userId,
              set: updates,
            })
            .returning();

          return updated ?? null;
        },
      },
    );
  }),
);

export { GET, PATCH, handlePatchIcalSettingsRoute };
