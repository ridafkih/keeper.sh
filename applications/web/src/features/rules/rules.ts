import type { RuleAction, RuleCondition, SyncRule } from "@keeper.sh/data-schemas";
import type { CalendarDetail, CalendarSource } from "@/types/api";
import { canPull } from "@/utils/calendars";

export type ConditionKind = RuleCondition["kind"];
export type ActionKind = RuleAction["kind"];

export interface SyncRuleListItem extends SyncRule {
  assignmentCount: number;
}

export interface RuleAssignment {
  sourceId: string;
  destinationId: string;
}

export interface SyncRuleDetail extends SyncRule {
  assignments: RuleAssignment[];
}

export type SourceDetails = Record<string, CalendarDetail>;

export interface CalendarPair {
  source: CalendarSource;
  destination: CalendarSource;
}

export interface PairGroup {
  source: CalendarSource;
  destinations: CalendarSource[];
}

export const TEMPLATE_VARIABLES = { calendar_name: "Calendar Name", event_name: "Event Name" };

export const CONDITION_ORDER: readonly ConditionKind[] = ["title_contains", "all_day", "timed", "focus_time", "out_of_office"];
export const ACTION_ORDER: readonly ActionKind[] = ["skip", "rename", "drop_description", "drop_location", "mark_private"];

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

const CONDITION_PHRASES: Record<Exclude<ConditionKind, "title_contains">, string> = {
  all_day: "all-day",
  focus_time: "focus time",
  out_of_office: "out of office",
  timed: "timed",
};

const ACTION_PHRASES: Record<Exclude<ActionKind, "rename">, string> = {
  drop_description: "no description",
  drop_location: "no location",
  mark_private: "private",
  skip: "not copied",
};

// All-day and timed cannot both hold, so offering the second would build a rule that never matches.
const OPPOSITES: Partial<Record<ConditionKind, ConditionKind>> = { all_day: "timed", timed: "all_day" };

export const describeCondition = (condition: RuleCondition): string =>
  condition.kind === "title_contains" ? `title contains "${condition.value}"` : CONDITION_PHRASES[condition.kind];

export const describeAction = (action: RuleAction): string =>
  action.kind === "rename" ? `renamed "${action.template}"` : ACTION_PHRASES[action.kind];

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const isSkip = (action: RuleAction): boolean => action.kind === "skip";

export const normalizeActions = (actions: RuleAction[]): RuleAction[] =>
  actions.some(isSkip) ? [{ kind: "skip" }] : actions;

export const summarizeRule = (rule: Pick<SyncRule, "actions" | "conditions">): string => {
  const when = rule.conditions.length === 0 ? "Every event" : capitalize(rule.conditions.map(describeCondition).join(", "));
  const then = rule.actions.length === 0 ? "copied as-is" : normalizeActions(rule.actions).map(describeAction).join(", ");
  return `${when} · ${then}`;
};

export const availableConditionKinds = (conditions: RuleCondition[]): ConditionKind[] => {
  const present = new Set(conditions.map((condition) => condition.kind));
  return CONDITION_ORDER.filter((kind) => {
    if (kind === "title_contains") return true;
    const opposite = OPPOSITES[kind];
    return !present.has(kind) && (opposite === undefined || !present.has(opposite));
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

export const resolveDefaultRule = <T extends SyncRule>(rules: T[] | undefined): T | undefined =>
  rules?.find((rule) => rule.isDefault) ?? rules?.[0];

export const pairKey = (sourceId: string, destinationId: string): string => `${sourceId}::${destinationId}`;

export const pairRulesPath = (sourceId: string, destinationId: string): string =>
  `/api/sources/${sourceId}/destinations/${destinationId}/rules`;

export const pairPagePath = (sourceId: string, destinationId: string): string =>
  `/dashboard/rules/pairs/${sourceId}/${destinationId}`;

export const calendarPagePath = (calendar: Pick<CalendarSource, "accountId" | "id">): string =>
  `/dashboard/accounts/${calendar.accountId}/${calendar.id}`;

export const buildPairGroups = (sources: CalendarSource[], details: SourceDetails): PairGroup[] => {
  const byId = new Map(sources.map((source) => [source.id, source] as const));
  const groups: PairGroup[] = [];
  for (const source of sources) {
    if (!canPull(source)) continue;
    const destinations = (details[source.id]?.destinationIds ?? [])
      .map((id) => byId.get(id))
      .filter((destination) => destination !== undefined);
    if (destinations.length > 0) groups.push({ destinations, source });
  }
  return groups;
};

export const flattenPairs = (groups: PairGroup[]): CalendarPair[] =>
  groups.flatMap((group) => group.destinations.map((destination) => ({ destination, source: group.source })));

export const countPairs = (groups: PairGroup[]): number =>
  groups.reduce((total, group) => total + group.destinations.length, 0);

export const findPair = (groups: PairGroup[], sourceId: string, destinationId: string): CalendarPair | undefined =>
  flattenPairs(groups).find((pair) => pair.source.id === sourceId && pair.destination.id === destinationId);

export const resolveAppliedRules = <T extends SyncRule>(ruleIds: string[], rules: T[]): T[] =>
  ruleIds.map((id) => rules.find((rule) => rule.id === id)).filter((rule) => rule !== undefined);

export const resolveUnappliedRules = <T extends SyncRule>(ruleIds: string[], rules: T[]): T[] =>
  rules.filter((rule) => !ruleIds.includes(rule.id));

export const splitPairsByAssignment = (
  groups: PairGroup[],
  assignments: RuleAssignment[],
): { assigned: CalendarPair[]; unassigned: CalendarPair[] } => {
  const keys = new Set(assignments.map((assignment) => pairKey(assignment.sourceId, assignment.destinationId)));
  const pairs = flattenPairs(groups);
  return {
    assigned: pairs.filter((pair) => keys.has(pairKey(pair.source.id, pair.destination.id))),
    unassigned: pairs.filter((pair) => !keys.has(pairKey(pair.source.id, pair.destination.id))),
  };
};
