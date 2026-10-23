import type { SourcePatchBody } from "@/utils/request-body";
import { sourcePatchBodySchema } from "@/utils/request-body";
import { idParamSchema } from "@/utils/request-query";
import { ErrorResponse } from "@/utils/responses";

const SOURCE_BOOLEAN_UPDATE_FIELDS = [
  "includeInIcalFeed",
  "treatFullDayTimedEventsAsAllDay",
] as const;

const PRO_GATED_SOURCE_FIELDS = [
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

type SourceUpdateValue = string | boolean | number | null;

interface CalendarPauseResult {
  calendarId: string;
  paused: boolean;
}

interface PatchSourceDependencies {
  updateSource: (
    userId: string,
    sourceCalendarId: string,
    updates: Record<string, SourceUpdateValue>,
  ) => Promise<Record<string, unknown> | null>;
  setPaused: (userId: string, sourceCalendarId: string, paused: boolean) => Promise<CalendarPauseResult | null>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
}

const buildSourceUpdates = (
  body: SourcePatchBody,
): Record<string, SourceUpdateValue> => {
  const updates: Record<string, SourceUpdateValue> = {};

  if (body.name) {
    updates.name = body.name;
  }
  if (typeof body.syncHistoricRange === "string") {
    updates.syncHistoricRange = body.syncHistoricRange;
  }
  if (typeof body.syncFutureRange === "string") {
    updates.syncFutureRange = body.syncFutureRange;
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
    return typeof value === "boolean" || typeof value === "string";
  });
  if (hasProGatedUpdates) {
    const allowed = await dependencies.canUseEventFilters(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden("This setting requires a Pro plan.").toResponse();
    }
  }

  const updates = buildSourceUpdates(parsedBody);
  const { paused } = parsedBody;

  if (Object.keys(updates).length === 0 && typeof paused !== "boolean") {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  if (typeof paused === "boolean") {
    const pauseResult = await dependencies.setPaused(context.userId, resolvedId.id, paused);
    if (!pauseResult) {
      return ErrorResponse.notFound().toResponse();
    }
    if (Object.keys(updates).length === 0) {
      return Response.json(pauseResult);
    }
  }

  const updated = await dependencies.updateSource(context.userId, resolvedId.id, updates);
  if (!updated) {
    return ErrorResponse.notFound().toResponse();
  }

  return Response.json(updated);
};

export { handlePatchSourceRoute };
