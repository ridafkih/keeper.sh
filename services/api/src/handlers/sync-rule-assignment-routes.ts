import { syncRuleAssignmentsBodySchema } from "@keeper.sh/data-schemas";
import { ErrorResponse } from "@/utils/responses";
import {
  MAPPING_NOT_FOUND_ERROR_MESSAGE,
  MappingNotFoundError,
  UNOWNED_RULES_ERROR_MESSAGE,
} from "@/utils/sync-rules";
import type { CalendarPair } from "@/utils/sync-rule-rows";

interface PairRouteContext {
  params: Record<string, string | string[] | undefined>;
  userId: string;
}

const EMPTY_PARAM_LENGTH = 0;

// Bun's file router repeats an outer directory's param when a deeper segment is dynamic too.
const readParam = (value: string | string[] | undefined): string | null => {
  let candidate = value;
  if (Array.isArray(value)) {
    [candidate] = value;
  }
  if (typeof candidate === "string" && candidate.length > EMPTY_PARAM_LENGTH) {
    return candidate;
  }
  return null;
};

const resolvePair = (params: PairRouteContext["params"]): CalendarPair | Response => {
  const sourceCalendarId = readParam(params.id);
  const destinationCalendarId = readParam(params.destinationId);
  if (!sourceCalendarId || !destinationCalendarId) {
    return ErrorResponse.badRequest("Source and destination IDs are required.").toResponse();
  }
  return { destinationCalendarId, sourceCalendarId };
};

interface GetPairRulesDependencies {
  getRuleAssignments: (userId: string, pair: CalendarPair) => Promise<string[] | null>;
}

const handleGetPairRulesRoute = async (
  context: PairRouteContext,
  dependencies: GetPairRulesDependencies,
): Promise<Response> => {
  const pair = resolvePair(context.params);
  if (pair instanceof Response) {
    return pair;
  }

  const ruleIds = await dependencies.getRuleAssignments(context.userId, pair);
  if (ruleIds === null) {
    return ErrorResponse.notFound(MAPPING_NOT_FOUND_ERROR_MESSAGE).toResponse();
  }
  return Response.json({ ruleIds });
};

interface PutPairRulesDependencies {
  setRuleAssignments: (userId: string, pair: CalendarPair, ruleIds: string[]) => Promise<void>;
}

const handlePutPairRulesRoute = async (
  context: PairRouteContext & { body: unknown },
  dependencies: PutPairRulesDependencies,
): Promise<Response> => {
  const pair = resolvePair(context.params);
  if (pair instanceof Response) {
    return pair;
  }

  if (!syncRuleAssignmentsBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("ruleIds array is required").toResponse();
  }

  try {
    await dependencies.setRuleAssignments(context.userId, pair, context.body.ruleIds);
  } catch (error) {
    if (error instanceof MappingNotFoundError) {
      return ErrorResponse.notFound(error.message).toResponse();
    }
    if (error instanceof Error && error.message === UNOWNED_RULES_ERROR_MESSAGE) {
      return ErrorResponse.badRequest(error.message).toResponse();
    }
    throw error;
  }

  return Response.json({ success: true });
};

export { handleGetPairRulesRoute, handlePutPairRulesRoute };
