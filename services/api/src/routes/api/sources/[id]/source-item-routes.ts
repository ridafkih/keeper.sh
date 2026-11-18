import { canExcludeAvailability, normalizeTitleKeywords } from "@keeper.sh/data-schemas";
import type { SourcePatchBody } from "@/utils/request-body";
import { sourcePatchBodySchema } from "@/utils/request-body";
import { idParamSchema } from "@/utils/request-query";
import { ErrorResponse } from "@/utils/responses";

const EVENT_FILTER_FIELDS = [
  "excludeAllDayEvents",
  "excludeEventDescription",
  "excludeEventLocation",
  "excludeEventName",
  "excludeFocusTime",
  "excludeOutOfOffice",
  "markEventsAsPrivate",
  "disableEventReminders",
] as const;

const SOURCE_BOOLEAN_UPDATE_FIELDS = [
  ...EVENT_FILTER_FIELDS,
  "includeInIcalFeed",
  "treatFullDayTimedEventsAsAllDay",
] as const;

const PRO_GATED_SOURCE_FIELDS = [
  ...EVENT_FILTER_FIELDS,
  "excludeAvailabilities",
  "excludeFreeEvents",
  "excludeTitleKeywords",
  "customEventName",
  "treatFullDayTimedEventsAsAllDay",
  "syncHistoricRange",
  "syncFutureRange",
] as const;

interface SourceRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface PatchSourceRouteContext extends SourceRouteContext {
  body: unknown;
}

type SourceUpdateValue = string | string[] | boolean | number | null;

interface SourceExclusionState {
  provider: string;
  excludeAvailabilities: string[];
}

interface PatchSourceDependencies {
  updateSource: (
    userId: string,
    sourceCalendarId: string,
    updates: Record<string, SourceUpdateValue>,
  ) => Promise<Record<string, unknown> | null>;
  getSourceExclusionState: (
    userId: string,
    sourceCalendarId: string,
  ) => Promise<SourceExclusionState | null>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
}

const FREE_AVAILABILITY = "free";

const applyLegacyExcludeFreeEvents = (
  excludeAvailabilities: string[],
  excludeFreeEvents: boolean,
): string[] => {
  const withoutFree = excludeAvailabilities.filter((value) => value !== FREE_AVAILABILITY);
  if (excludeFreeEvents) {
    return [...withoutFree, FREE_AVAILABILITY];
  }
  return withoutFree;
};

const resolveExcludeAvailabilities = async (
  userId: string,
  sourceCalendarId: string,
  body: SourcePatchBody,
  dependencies: PatchSourceDependencies,
): Promise<string[] | Response | null> => {
  const { excludeAvailabilities, excludeFreeEvents } = body;
  if (!excludeAvailabilities && typeof excludeFreeEvents !== "boolean") {
    return null;
  }

  const source = await dependencies.getSourceExclusionState(userId, sourceCalendarId);
  if (!source) {
    return ErrorResponse.notFound().toResponse();
  }

  const requested = excludeAvailabilities
    ?? applyLegacyExcludeFreeEvents(source.excludeAvailabilities, excludeFreeEvents === true);
  const unsupported = requested.filter(
    (availability) => !canExcludeAvailability(source.provider, availability),
  );
  if (unsupported.length > 0) {
    return ErrorResponse.badRequest(
      `This calendar cannot exclude events by ${unsupported.join(", ")}.`,
    ).toResponse();
  }

  return [...new Set(requested)];
};

const buildSourceUpdates = (
  body: SourcePatchBody,
): Record<string, SourceUpdateValue> => {
  const updates: Record<string, SourceUpdateValue> = {};

  if (body.name) {
    updates.name = body.name;
  }
  if (typeof body.customEventName === "string") {
    updates.customEventName = body.customEventName;
  }
  if (typeof body.syncHistoricRange === "string") {
    updates.syncHistoricRange = body.syncHistoricRange;
  }
  if (typeof body.syncFutureRange === "string") {
    updates.syncFutureRange = body.syncFutureRange;
  }
  if (body.excludeTitleKeywords) {
    updates.excludeTitleKeywords = normalizeTitleKeywords(body.excludeTitleKeywords);
  }

  for (const field of SOURCE_BOOLEAN_UPDATE_FIELDS) {
    if (typeof body[field] === "boolean") {
      updates[field] = body[field];
    }
  }

  return updates;
};

const resolveId = (
  params: Record<string, string>,
): { id: string } | Response => {
  if (!params.id || !idParamSchema.allows(params)) {
    return ErrorResponse.badRequest("ID is required").toResponse();
  }
  return { id: params.id };
};

const handlePatchSourceRoute = async (
  context: PatchSourceRouteContext,
  dependencies: PatchSourceDependencies,
): Promise<Response> => {
  const resolvedId = resolveId(context.params);
  if (resolvedId instanceof Response) {
    return resolvedId;
  }

  let parsedBody: SourcePatchBody = {};
  if (sourcePatchBodySchema.allows(context.body)) {
    parsedBody = context.body;
  }

  const hasProGatedUpdates = PRO_GATED_SOURCE_FIELDS.some((field) => {
    const value = parsedBody[field];
    return typeof value === "boolean" || typeof value === "string" || Array.isArray(value);
  });
  if (hasProGatedUpdates) {
    const allowed = await dependencies.canUseEventFilters(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden("This setting requires a Pro plan.").toResponse();
    }
  }

  const updates = buildSourceUpdates(parsedBody);

  const excludeAvailabilities = await resolveExcludeAvailabilities(
    context.userId,
    resolvedId.id,
    parsedBody,
    dependencies,
  );
  if (excludeAvailabilities instanceof Response) {
    return excludeAvailabilities;
  }
  if (excludeAvailabilities) {
    updates.excludeAvailabilities = excludeAvailabilities;
  }

  if (Object.keys(updates).length === 0) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  const updated = await dependencies.updateSource(context.userId, resolvedId.id, updates);
  if (!updated) {
    return ErrorResponse.notFound().toResponse();
  }

  return Response.json(updated);
};

export { handlePatchSourceRoute };
