import {
  canExcludeAvailability,
  normalizeTitleKeywords,
  syncRuleOverridesPatchSchema,
} from "@keeper.sh/data-schemas";
import type { SyncRuleOverridesPatch } from "@keeper.sh/data-schemas";
import { isCalendarId } from "@/utils/calendar-pause";
import type {
  MappingSyncRules,
  MappingSyncRuleUpdates,
  SyncRuleOverrideUpdates,
} from "@/utils/mapping-sync-rules";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "@/utils/source-destination-mappings";
import { ErrorResponse } from "@/utils/responses";

interface MappingSyncRulesRouteContext {
  params: Record<string, string>;
  userId: string;
}

interface PatchMappingSyncRulesRouteContext extends MappingSyncRulesRouteContext {
  body: unknown;
}

interface GetMappingSyncRulesDependencies {
  getMappingSyncRules: (
    userId: string,
    sourceCalendarId: string,
    destinationCalendarId: string,
  ) => Promise<MappingSyncRules | null>;
}

interface PatchMappingSyncRulesDependencies extends GetMappingSyncRulesDependencies {
  canUseEventFilters: (userId: string) => Promise<boolean>;
  updateSyncRuleOverrides: (
    userId: string,
    sourceCalendarId: string,
    destinationCalendarId: string,
    updates: MappingSyncRuleUpdates,
  ) => Promise<MappingSyncRules | null>;
}

interface MappingIds {
  sourceCalendarId: string;
  destinationCalendarId: string;
}

const BOOLEAN_OVERRIDE_FIELDS = [
  "disableEventReminders",
  "excludeAllDayEvents",
  "excludeEventDescription",
  "excludeEventLocation",
  "excludeEventName",
  "excludeFocusTime",
  "excludeOutOfOffice",
  "markEventsAsPrivate",
] as const;

const resolveMappingIds = (params: Record<string, string>): MappingIds | null => {
  const { id, destinationId } = params;
  if (!isCalendarId(id) || !isCalendarId(destinationId)) {
    return null;
  }
  return { destinationCalendarId: destinationId, sourceCalendarId: id };
};

const serializeMappingSyncRules = (rules: MappingSyncRules) => ({
  destinationCalendarId: rules.destinationCalendarId,
  effectiveRules: rules.effectiveRules,
  includeUpstreamSources: rules.includeUpstreamSources,
  overrides: rules.overrides,
  sourceCalendarId: rules.sourceCalendarId,
  sourceRules: rules.sourceRules,
});

const isBooleanOrNull = (value: unknown): value is boolean | null =>
  typeof value === "boolean" || value === null;

const isStringOrNull = (value: unknown): value is string | null =>
  typeof value === "string" || value === null;

const isArrayOrNull = <TItem>(value: TItem[] | null | undefined): value is TItem[] | null =>
  Array.isArray(value) || value === null;

const resolveCustomEventNameUpdate = (
  customEventName: string | null,
): string | null | Response => {
  if (customEventName === null) {
    return null;
  }
  const trimmed = customEventName.trim();
  if (trimmed.length === 0) {
    return ErrorResponse.badRequest(
      "customEventName cannot be blank. Send null to use the calendar's own event name.",
    ).toResponse();
  }
  return trimmed;
};

const resolveExcludeAvailabilitiesUpdate = (
  excludeAvailabilities: string[] | null,
  sourceProvider: string,
): string[] | null | Response => {
  if (excludeAvailabilities === null) {
    return null;
  }
  const unsupported = excludeAvailabilities.filter(
    (availability) => !canExcludeAvailability(sourceProvider, availability),
  );
  if (unsupported.length > 0) {
    return ErrorResponse.badRequest(
      `This calendar cannot exclude events by ${unsupported.join(", ")}.`,
    ).toResponse();
  }
  return [...new Set(excludeAvailabilities)];
};

const resolveExcludeTitleKeywordsUpdate = (keywords: string[] | null): string[] | null => {
  if (keywords === null) {
    return null;
  }
  return normalizeTitleKeywords(keywords);
};

const buildSyncRuleOverrideUpdates = (
  body: SyncRuleOverridesPatch,
  sourceProvider: string,
): SyncRuleOverrideUpdates | Response => {
  const updates: SyncRuleOverrideUpdates = {};

  for (const field of BOOLEAN_OVERRIDE_FIELDS) {
    const value = body[field];
    if (isBooleanOrNull(value)) {
      updates[field] = value;
    }
  }

  if (isStringOrNull(body.customEventName)) {
    const customEventName = resolveCustomEventNameUpdate(body.customEventName);
    if (customEventName instanceof Response) {
      return customEventName;
    }
    updates.customEventName = customEventName;
  }

  if (isArrayOrNull(body.excludeAvailabilities)) {
    const excludeAvailabilities = resolveExcludeAvailabilitiesUpdate(
      body.excludeAvailabilities,
      sourceProvider,
    );
    if (excludeAvailabilities instanceof Response) {
      return excludeAvailabilities;
    }
    updates.excludeAvailabilities = excludeAvailabilities;
  }

  if (isArrayOrNull(body.excludeTitleKeywords)) {
    updates.excludeTitleKeywords = resolveExcludeTitleKeywordsUpdate(body.excludeTitleKeywords);
  }

  return updates;
};

const withUpstreamSourcesUpdate = (
  body: SyncRuleOverridesPatch,
  overrideUpdates: SyncRuleOverrideUpdates,
): MappingSyncRuleUpdates => {
  if (typeof body.includeUpstreamSources !== "boolean") {
    return overrideUpdates;
  }
  return { ...overrideUpdates, includeUpstreamSources: body.includeUpstreamSources };
};

const isMappingLimitError = (error: unknown): boolean =>
  error instanceof Error && error.message === MAPPING_LIMIT_ERROR_MESSAGE;

const setsAnOverride = (updates: SyncRuleOverrideUpdates): boolean =>
  Object.values(updates).some((value) => value !== null);

const handleGetMappingSyncRulesRoute = async (
  context: MappingSyncRulesRouteContext,
  dependencies: GetMappingSyncRulesDependencies,
): Promise<Response> => {
  const ids = resolveMappingIds(context.params);
  if (!ids) {
    return ErrorResponse.notFound().toResponse();
  }

  const rules = await dependencies.getMappingSyncRules(
    context.userId,
    ids.sourceCalendarId,
    ids.destinationCalendarId,
  );
  if (!rules) {
    return ErrorResponse.notFound().toResponse();
  }

  return Response.json(serializeMappingSyncRules(rules));
};

const handlePatchMappingSyncRulesRoute = async (
  context: PatchMappingSyncRulesRouteContext,
  dependencies: PatchMappingSyncRulesDependencies,
): Promise<Response> => {
  const ids = resolveMappingIds(context.params);
  if (!ids) {
    return ErrorResponse.notFound().toResponse();
  }

  if (!syncRuleOverridesPatchSchema.allows(context.body)) {
    return ErrorResponse.badRequest(
      "Body must only contain sync rule fields set to a value or null.",
    ).toResponse();
  }

  const existing = await dependencies.getMappingSyncRules(
    context.userId,
    ids.sourceCalendarId,
    ids.destinationCalendarId,
  );
  if (!existing) {
    return ErrorResponse.notFound().toResponse();
  }

  const overrideUpdates = buildSyncRuleOverrideUpdates(context.body, existing.sourceProvider);
  if (overrideUpdates instanceof Response) {
    return overrideUpdates;
  }
  const updates = withUpstreamSourcesUpdate(context.body, overrideUpdates);
  if (Object.keys(updates).length === 0) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  if (setsAnOverride(overrideUpdates)) {
    const allowed = await dependencies.canUseEventFilters(context.userId);
    if (!allowed) {
      return ErrorResponse.forbidden("This setting requires a Pro plan.").toResponse();
    }
  }

  try {
    const updated = await dependencies.updateSyncRuleOverrides(
      context.userId,
      ids.sourceCalendarId,
      ids.destinationCalendarId,
      updates,
    );
    if (!updated) {
      return ErrorResponse.notFound().toResponse();
    }

    return Response.json(serializeMappingSyncRules(updated));
  } catch (error) {
    if (isMappingLimitError(error)) {
      return ErrorResponse.paymentRequired(MAPPING_LIMIT_ERROR_MESSAGE).toResponse();
    }
    throw error;
  }
};

export { handleGetMappingSyncRulesRoute, handlePatchMappingSyncRulesRoute };
export type {
  GetMappingSyncRulesDependencies,
  PatchMappingSyncRulesDependencies,
};
