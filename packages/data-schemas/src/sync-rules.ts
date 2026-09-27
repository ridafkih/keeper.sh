import { type } from "arktype";

const RULE_NAME_MAX_LENGTH = 80;
const RULE_TEMPLATE_MAX_LENGTH = 200;
const MAX_RULE_CONDITIONS = 10;
const MAX_RULE_ACTIONS = 5;
const TEMPLATE_TOKEN_PATTERN = /\{\{(\w+)\}\}/g;
const DEFAULT_EVENT_NAME = "Busy";

const ruleConditionSchema = type({
  kind: "'title_contains'",
  value: "string >= 1",
  "+": "reject",
}).or({
  kind: "'all_day' | 'timed' | 'focus_time' | 'out_of_office'",
  "+": "reject",
});
type RuleCondition = typeof ruleConditionSchema.infer;

const ruleActionSchema = type({
  kind: "'skip'",
  "+": "reject",
}).or({
  kind: "'rename'",
  template: `string <= ${RULE_TEMPLATE_MAX_LENGTH}`,
  "+": "reject",
}).or({
  kind: "'drop_description' | 'drop_location' | 'mark_private'",
  "+": "reject",
});
type RuleAction = typeof ruleActionSchema.infer;

const ruleMatchSchema = type("'all' | 'any'");
type RuleMatch = typeof ruleMatchSchema.infer;

const ruleConditionsSchema = ruleConditionSchema.array().atMostLength(MAX_RULE_CONDITIONS);
const ruleActionsSchema = ruleActionSchema.array().atMostLength(MAX_RULE_ACTIONS);

/* A rule name is shown to the user and must survive a round trip, so an
 * all-whitespace name is rejected rather than silently stored. */
const syncRuleNameSchema = type(`string <= ${RULE_NAME_MAX_LENGTH}`).narrow(
  (value) => value.trim().length > 0,
);

const syncRuleSchema = type({
  actions: ruleActionsSchema,
  conditions: ruleConditionsSchema,
  createdAt: "string",
  id: "string",
  isDefault: "boolean",
  name: "string",
  updatedAt: "string",
});
type SyncRule = typeof syncRuleSchema.infer;

const createSyncRuleBodySchema = type({
  name: "string",
  "conditions?": ruleConditionsSchema,
  "actions?": ruleActionsSchema,
  "+": "reject",
});
type CreateSyncRuleBody = typeof createSyncRuleBodySchema.infer;

const patchSyncRuleBodySchema = type({
  "name?": "string",
  "conditions?": ruleConditionsSchema,
  "actions?": ruleActionsSchema,
  "+": "reject",
});
type PatchSyncRuleBody = typeof patchSyncRuleBodySchema.infer;

const syncRuleAssignmentsBodySchema = type({
  ruleIds: "string[]",
  "+": "reject",
});
type SyncRuleAssignmentsBody = typeof syncRuleAssignmentsBodySchema.infer;

const DEFAULT_RULE = {
  actions: [
    { kind: "rename", template: "{{calendar_name}}" },
    { kind: "drop_description" },
    { kind: "drop_location" },
  ],
  conditions: [],
  name: "Busy only",
} as const satisfies Pick<SyncRule, "actions" | "conditions" | "name">;

interface RuleEventFacts {
  calendarName: string | null;
  description?: string;
  isAllDay: boolean;
  isFocusTime: boolean;
  isOutOfOffice: boolean;
  location?: string;
  title: string;
}

type RuleEvaluation =
  | { skip: true }
  | {
    skip: false;
    summary: string;
    description?: string;
    location?: string;
    isPrivate?: true;
  };

const resolveEventNameTemplate = (
  template: string,
  variables: Record<string, string>,
): string => {
  const resolved = template.replace(
    TEMPLATE_TOKEN_PATTERN,
    (token, variableName) => variables[variableName] ?? token,
  ).trim();

  return resolved || variables.calendar_name || DEFAULT_EVENT_NAME;
};

const CONDITION_MATCHERS: Record<
  RuleCondition["kind"],
  (condition: RuleCondition, facts: RuleEventFacts) => boolean
> = {
  all_day: (_condition, facts) => facts.isAllDay,
  focus_time: (_condition, facts) => facts.isFocusTime,
  out_of_office: (_condition, facts) => facts.isOutOfOffice,
  timed: (_condition, facts) => !facts.isAllDay,
  title_contains: (condition, facts) =>
    condition.kind === "title_contains"
    && facts.title.toLocaleLowerCase().includes(condition.value.toLocaleLowerCase()),
};

const matchesCondition = (condition: RuleCondition, facts: RuleEventFacts): boolean =>
  CONDITION_MATCHERS[condition.kind](condition, facts);

interface MatchableRule {
  conditions: readonly RuleCondition[];
  match?: RuleMatch;
}

// An empty condition list matches everything, whether the rule matches any or all.
const matchesRule = (rule: MatchableRule, facts: RuleEventFacts): boolean => {
  if (rule.conditions.length === 0) {
    return true;
  }
  const test = (condition: RuleCondition) => matchesCondition(condition, facts);
  if (rule.match === "any") {
    return rule.conditions.some(test);
  }
  return rule.conditions.every(test);
};

const findMatchingRule = <TRule extends MatchableRule>(
  rules: readonly TRule[],
  facts: RuleEventFacts,
): TRule | null => rules.find((rule) => matchesRule(rule, facts)) ?? null;

type RuleCopy = Extract<RuleEvaluation, { skip: false }>;

const applyRuleActions = (
  actions: readonly RuleAction[],
  facts: RuleEventFacts,
): RuleEvaluation => {
  const kinds = new Set(actions.map((action) => action.kind));
  if (kinds.has("skip")) {
    return { skip: true };
  }

  const copy: RuleCopy = { skip: false, summary: facts.title };
  for (const action of actions) {
    if (action.kind === "rename") {
      copy.summary = resolveEventNameTemplate(action.template, {
        calendar_name: facts.calendarName ?? "",
        event_name: facts.title,
      });
    }
  }
  if (!kinds.has("drop_description") && typeof facts.description === "string") {
    copy.description = facts.description;
  }
  if (!kinds.has("drop_location") && typeof facts.location === "string") {
    copy.location = facts.location;
  }
  if (kinds.has("mark_private")) {
    copy.isPrivate = true;
  }
  return copy;
};

const evaluateRules = <TRule extends MatchableRule & Pick<SyncRule, "actions">>(
  rules: readonly TRule[],
  facts: RuleEventFacts,
): RuleEvaluation => {
  const rule = findMatchingRule(rules, facts);
  if (!rule) {
    return { skip: true };
  }
  return applyRuleActions(rule.actions, facts);
};

const normalizeAction = (action: RuleAction): RuleAction => {
  if (action.kind === "rename") {
    return { kind: "rename", template: action.template.trim() };
  }
  return action;
};

const areRuleActionsEqual = (left: readonly RuleAction[], right: readonly RuleAction[]): boolean =>
  JSON.stringify(left.map((action) => normalizeAction(action)))
  === JSON.stringify(right.map((action) => normalizeAction(action)));

const areRuleConditionsEqual = (
  left: readonly RuleCondition[],
  right: readonly RuleCondition[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

export {
  DEFAULT_RULE,
  applyRuleActions,
  areRuleActionsEqual,
  areRuleConditionsEqual,
  createSyncRuleBodySchema,
  evaluateRules,
  findMatchingRule,
  matchesCondition,
  matchesRule,
  patchSyncRuleBodySchema,
  resolveEventNameTemplate,
  ruleActionSchema,
  ruleConditionSchema,
  ruleMatchSchema,
  syncRuleAssignmentsBodySchema,
  syncRuleNameSchema,
  syncRuleSchema,
};
export type {
  CreateSyncRuleBody,
  PatchSyncRuleBody,
  RuleAction,
  RuleCondition,
  RuleEvaluation,
  RuleEventFacts,
  RuleMatch,
  SyncRule,
  SyncRuleAssignmentsBody,
};
