import { HTTP_STATUS } from "@keeper.sh/constants";
import {
  DEFAULT_RULE,
  createSyncRuleBodySchema,
  patchSyncRuleBodySchema,
  syncRuleNameSchema,
} from "@keeper.sh/data-schemas";
import type { SyncRule } from "@keeper.sh/data-schemas";
import { ErrorResponse } from "@/utils/responses";
import {
  DefaultRuleDeletionError,
  RuleContentNotAllowedError,
  RuleLimitError,
  RuleNotFoundError,
} from "@/utils/sync-rules";
import type {
  RuleContent,
  RuleUpdates,
  SyncRuleDetail,
  SyncRuleListItem,
} from "@/utils/sync-rules";

const EMPTY_UPDATE_COUNT = 0;
const RULE_ID_REQUIRED_MESSAGE = "Rule ID is required.";
const RULE_NAME_EMPTY_MESSAGE = "Rule name cannot be empty.";

interface RouteParams {
  params: Record<string, string | undefined>;
  userId: string;
}

interface ListRulesDependencies {
  ensureDefaultRule: (userId: string) => Promise<unknown>;
  listRules: (userId: string) => Promise<SyncRuleListItem[]>;
}

const handleListRulesRoute = async (
  context: { userId: string },
  dependencies: ListRulesDependencies,
): Promise<Response> => {
  await dependencies.ensureDefaultRule(context.userId);
  return Response.json(await dependencies.listRules(context.userId));
};

interface CreateRuleDependencies {
  createRule: (userId: string, input: { name: string } & RuleContent) => Promise<SyncRule>;
}

const mapRuleWriteError = (error: unknown): Response | null => {
  if (error instanceof RuleLimitError || error instanceof RuleContentNotAllowedError) {
    return ErrorResponse.forbidden(error.message).toResponse();
  }
  if (error instanceof RuleNotFoundError) {
    return ErrorResponse.notFound(error.message).toResponse();
  }
  return null;
};

const handleCreateRuleRoute = async (
  context: { body: unknown; userId: string },
  dependencies: CreateRuleDependencies,
): Promise<Response> => {
  if (!createSyncRuleBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("Rule name is required.").toResponse();
  }

  const name = context.body.name.trim();
  if (!syncRuleNameSchema.allows(name)) {
    return ErrorResponse.badRequest(RULE_NAME_EMPTY_MESSAGE).toResponse();
  }

  try {
    const rule = await dependencies.createRule(context.userId, {
      actions: context.body.actions ?? [...DEFAULT_RULE.actions],
      conditions: context.body.conditions ?? [...DEFAULT_RULE.conditions],
      name,
    });
    return Response.json(rule, { status: HTTP_STATUS.CREATED });
  } catch (error) {
    const mapped = mapRuleWriteError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
};

interface GetRuleDependencies {
  findRule: (userId: string, ruleId: string) => Promise<SyncRuleDetail | null>;
}

const handleGetRuleRoute = async (
  context: RouteParams,
  dependencies: GetRuleDependencies,
): Promise<Response> => {
  const ruleId = context.params.id;
  if (!ruleId) {
    return ErrorResponse.badRequest(RULE_ID_REQUIRED_MESSAGE).toResponse();
  }

  const rule = await dependencies.findRule(context.userId, ruleId);
  if (!rule) {
    return ErrorResponse.notFound("Rule not found.").toResponse();
  }
  return Response.json(rule);
};

interface PatchRuleDependencies {
  updateRule: (userId: string, ruleId: string, updates: RuleUpdates) => Promise<SyncRule>;
}

const buildRuleUpdates = (body: typeof patchSyncRuleBodySchema.infer): RuleUpdates => ({
  ...(typeof body.name === "string" && { name: body.name.trim() }),
  ...(body.conditions && { conditions: body.conditions }),
  ...(body.actions && { actions: body.actions }),
});

const handlePatchRuleRoute = async (
  context: RouteParams & { body: unknown },
  dependencies: PatchRuleDependencies,
): Promise<Response> => {
  const ruleId = context.params.id;
  if (!ruleId) {
    return ErrorResponse.badRequest(RULE_ID_REQUIRED_MESSAGE).toResponse();
  }

  if (!patchSyncRuleBodySchema.allows(context.body)) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }

  const updates = buildRuleUpdates(context.body);
  if (Object.keys(updates).length === EMPTY_UPDATE_COUNT) {
    return ErrorResponse.badRequest("No valid fields to update").toResponse();
  }
  if (typeof updates.name === "string" && !syncRuleNameSchema.allows(updates.name)) {
    return ErrorResponse.badRequest(RULE_NAME_EMPTY_MESSAGE).toResponse();
  }

  try {
    return Response.json(await dependencies.updateRule(context.userId, ruleId, updates));
  } catch (error) {
    const mapped = mapRuleWriteError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }
};

interface DeleteRuleDependencies {
  deleteRule: (userId: string, ruleId: string) => Promise<void>;
}

const handleDeleteRuleRoute = async (
  context: RouteParams,
  dependencies: DeleteRuleDependencies,
): Promise<Response> => {
  const ruleId = context.params.id;
  if (!ruleId) {
    return ErrorResponse.badRequest(RULE_ID_REQUIRED_MESSAGE).toResponse();
  }

  try {
    await dependencies.deleteRule(context.userId, ruleId);
    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  } catch (error) {
    if (error instanceof DefaultRuleDeletionError) {
      return ErrorResponse.conflict(error.message).toResponse();
    }
    if (error instanceof RuleNotFoundError) {
      return ErrorResponse.notFound(error.message).toResponse();
    }
    throw error;
  }
};

export {
  handleCreateRuleRoute,
  handleDeleteRuleRoute,
  handleGetRuleRoute,
  handleListRulesRoute,
  handlePatchRuleRoute,
};
