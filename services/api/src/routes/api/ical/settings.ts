import { eq } from "drizzle-orm";
import { icalFeedSettingsTable } from "@keeper.sh/database/schema";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { database, premiumService } from "../../../context";
import {
  icalSettingsPatchBodySchema,
  type IcalSettingsPatchBody,
} from "../../../utils/request-body";

const DEFAULT_SETTINGS = {
  includeEventName: false,
  includeEventDescription: false,
  includeEventLocation: false,
  excludeAllDayEvents: false,
  customEventName: "Busy",
};

const ICAL_BOOLEAN_UPDATE_FIELDS = [
  "includeEventName",
  "includeEventDescription",
  "includeEventLocation",
  "excludeAllDayEvents",
] as const;

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

  const updated = await dependencies.upsertSettings(userId, updates);
  return Response.json(updated);
};

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const [settings] = await database
      .select()
      .from(icalFeedSettingsTable)
      .where(eq(icalFeedSettingsTable.userId, userId))
      .limit(1);

    return Response.json(settings ?? { userId, ...DEFAULT_SETTINGS });
  }),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const payload = await request.json();
    return handlePatchIcalSettingsRoute(
      { body: payload, userId },
      {
        canCustomizeIcalFeed: (resolvedUserId) => premiumService.canCustomizeIcalFeed(resolvedUserId),
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
