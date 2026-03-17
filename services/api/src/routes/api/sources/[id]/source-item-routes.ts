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
  "excludeWorkingLocation",
] as const;

const SOURCE_BOOLEAN_UPDATE_FIELDS = [
  ...EVENT_FILTER_FIELDS,
  "includeInIcalFeed",
] as const;

interface SourceRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface PatchSourceRouteContext extends SourceRouteContext {
  body: unknown;
}

interface PatchSourceDependencies {
  updateSource: (
    userId: string,
    sourceCalendarId: string,
    updates: Record<string, string | boolean>,
  ) => Promise<Record<string, unknown> | null>;
  canUseEventFilters: (userId: string) => Promise<boolean>;
}

const buildSourceUpdates = (
  body: SourcePatchBody,
): Record<string, string | boolean> => {
  const updates: Record<string, string | boolean> = {};

  if (body.name) {
    updates.name = body.name;
  }
  if (typeof body.customEventName === "string") {
    updates.customEventName = body.customEventName;
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

  const hasEventFilterUpdates = EVENT_FILTER_FIELDS.some(
    (field) => typeof parsedBody[field] === "boolean",
  );
  const isUpdatingEventNameTemplate = typeof parsedBody.customEventName === "string";
  if (hasEventFilterUpdates || isUpdatingEventNameTemplate) {
    const allowed = await dependencies.canUseEventFilters(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden("Event filters require a Pro plan.").toResponse();
    }
  }

  const updates = buildSourceUpdates(parsedBody);

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
