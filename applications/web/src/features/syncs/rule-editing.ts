import {
  MAX_RULE_ACTIONS,
  MAX_RULE_CONDITIONS,
  RULE_CONDITION_VALUE_MAX_LENGTH,
  RULE_NAME_MAX_LENGTH,
  RULE_TEMPLATE_MAX_LENGTH,
} from "@keeper.sh/data-schemas";
import type { AdvancedRule, RuleAction, RuleCondition, ShareAs } from "@keeper.sh/data-schemas";

export type ConditionKind = RuleCondition["kind"];
export type ActionKind = RuleAction["kind"];

export const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };
export const BUSY_TEMPLATE_VARIABLES = { calendar_name: "Calendar Name" };

// Busy Only hides the title, and the engine strips {{event_name}} from renames there, so it isn't offered.
export const templateVariablesFor = (shareAs: ShareAs): Record<string, string> =>
  shareAs === "busy_only" ? BUSY_TEMPLATE_VARIABLES : TEMPLATE_VARIABLES;

const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/* Secure contexts alone have crypto.randomUUID, and self-hosted instances are often plain HTTP.
 * The getRandomValues call works everywhere, and a v4 uuid keeps the server from replacing the id. */
export const createRuleId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const digits = hex(bytes);
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
};

const CONDITION_ORDER: readonly ConditionKind[] = [
  "title_contains", "all_day", "timed", "focus_time", "out_of_office", "busy", "free", "tentative",
];
const ACTION_ORDER: readonly ActionKind[] = ["skip", "rename", "drop_description", "drop_location", "mark_private"];

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  all_day: "Is All-Day",
  busy: "Shows as Busy",
  free: "Shows as Free",
  tentative: "Is Tentative",
  focus_time: "Is Focus Time",
  out_of_office: "Is Out of Office",
  timed: "Is Timed",
  title_contains: "Title Contains",
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  drop_description: "Drop the Description",
  drop_location: "Drop the Location",
  mark_private: "Mark as Private",
  rename: "Rename To",
  skip: "Don't Copy",
};

// All-day and timed (or busy and free) cannot both hold, so offering the second would build a rule that never matches when matching all.
const OPPOSITES: Partial<Record<ConditionKind, ConditionKind>> = {
  all_day: "timed",
  busy: "free",
  free: "busy",
  timed: "all_day",
};

export const isSkip = (action: RuleAction): boolean => action.kind === "skip";

export const normalizeActions = (actions: RuleAction[]): RuleAction[] =>
  actions.some(isSkip) ? [{ kind: "skip" }] : actions;

export const availableConditionKinds = (rule: Pick<AdvancedRule, "conditions" | "match">): ConditionKind[] => {
  if (rule.conditions.length >= MAX_RULE_CONDITIONS) return [];
  const present = new Set(rule.conditions.map((condition) => condition.kind));
  return CONDITION_ORDER.filter((kind) => {
    if (kind === "title_contains") return true;
    const opposite = OPPOSITES[kind];
    return !present.has(kind) && (rule.match === "any" || opposite === undefined || !present.has(opposite));
  });
};

export const availableActionKinds = (actions: RuleAction[]): ActionKind[] => {
  if (actions.some(isSkip)) return [];
  const present = new Set(actions.map((action) => action.kind));
  return ACTION_ORDER.filter((kind) => !present.has(kind));
};

export const createCondition = (kind: ConditionKind): RuleCondition =>
  kind === "title_contains" ? { kind, value: "" } : { kind };

export const createAction = (kind: ActionKind): RuleAction =>
  kind === "rename" ? { kind, template: "" } : { kind };

export const needsInput = (item: RuleCondition | RuleAction): boolean =>
  item.kind === "title_contains" || item.kind === "rename";

export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
};

export const removeAt = <T>(list: T[], index: number): T[] => list.filter((_, position) => position !== index);

export const replaceAt = <T>(list: T[], index: number, item: T): T[] =>
  list.map((current, position) => (position === index ? item : current));

const ruleLabel = (rule: Pick<AdvancedRule, "name">): string => rule.name.trim() || "A rule";

export const ruleProblem = (rule: AdvancedRule): string | null => {
  const label = ruleLabel(rule);
  if (rule.name.trim().length === 0) return "Every rule needs a name.";
  if (rule.name.length > RULE_NAME_MAX_LENGTH) return `Rule names can be up to ${RULE_NAME_MAX_LENGTH} characters.`;
  if (rule.conditions.length === 0) return `${label} needs a condition.`;
  if (rule.conditions.length > MAX_RULE_CONDITIONS) return `${label} can have up to ${MAX_RULE_CONDITIONS} conditions.`;
  if (rule.actions.length === 0) return `${label} needs an action.`;
  if (rule.actions.length > MAX_RULE_ACTIONS) return `${label} can have up to ${MAX_RULE_ACTIONS} actions.`;
  for (const condition of rule.conditions) {
    if (condition.kind !== "title_contains") continue;
    if (condition.value.trim().length === 0) return `${label} has an empty Title Contains.`;
    if (condition.value.length > RULE_CONDITION_VALUE_MAX_LENGTH) {
      return `In ${label}, Title Contains can be up to ${RULE_CONDITION_VALUE_MAX_LENGTH} characters.`;
    }
  }
  for (const action of rule.actions) {
    if (action.kind === "rename" && action.template.length > RULE_TEMPLATE_MAX_LENGTH) {
      return `In ${label}, Rename To can be up to ${RULE_TEMPLATE_MAX_LENGTH} characters.`;
    }
  }
  return null;
};
