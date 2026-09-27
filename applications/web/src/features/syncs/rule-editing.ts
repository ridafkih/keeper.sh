import type { AdvancedRule, RuleAction, RuleCondition } from "@keeper.sh/data-schemas";

export type ConditionKind = RuleCondition["kind"];
export type ActionKind = RuleAction["kind"];

export const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

const CONDITION_ORDER: readonly ConditionKind[] = ["title_contains", "all_day", "timed", "focus_time", "out_of_office"];
const ACTION_ORDER: readonly ActionKind[] = ["skip", "rename", "drop_description", "drop_location", "mark_private"];

export const CONDITION_LABELS: Record<ConditionKind, string> = {
  all_day: "Is All-Day",
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

// All-day and timed cannot both hold, so offering the second would build a rule that never matches when matching all.
const OPPOSITES: Partial<Record<ConditionKind, ConditionKind>> = { all_day: "timed", timed: "all_day" };

export const isSkip = (action: RuleAction): boolean => action.kind === "skip";

export const normalizeActions = (actions: RuleAction[]): RuleAction[] =>
  actions.some(isSkip) ? [{ kind: "skip" }] : actions;

export const availableConditionKinds = (rule: Pick<AdvancedRule, "conditions" | "match">): ConditionKind[] => {
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
