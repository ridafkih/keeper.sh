import type { CalendarSource } from "@/types/api";
import { canPull, canPush } from "@/utils/calendars";

export type DetailChoice = "calendar_name" | "busy" | "titles";

export type SetupBlank = { kind: "from" } | { kind: "to"; index: number };

export interface SetupRule {
  id: string;
  fromId: string | null;
  toIds: string[];
  detail: DetailChoice;
}

export interface SetupPending {
  ruleId: string;
  blank: SetupBlank;
}

export interface SetupDraft {
  version: 2;
  rules: SetupRule[];
  pending: SetupPending | null;
}

export type CompleteRule = SetupRule & { fromId: string };

const DRAFT_VERSION = 2;
const DEFAULT_DETAIL: DetailChoice = "calendar_name";

const createRule = (fromId: string | null = null, toIds: string[] = [], detail: DetailChoice = DEFAULT_DETAIL): SetupRule => ({
  detail,
  fromId,
  id: crypto.randomUUID(),
  toIds,
});

export const createEmptyDraft = (): SetupDraft => ({
  pending: null,
  rules: [createRule()],
  version: DRAFT_VERSION,
});

export const sameBlank = (left: SetupBlank, right: SetupBlank): boolean =>
  left.kind === right.kind && (left.kind !== "to" || right.kind !== "to" || left.index === right.index);

export const isRuleComplete = (rule: SetupRule): rule is CompleteRule =>
  rule.fromId !== null && rule.toIds.length > 0;

export const completeRules = (draft: SetupDraft): CompleteRule[] => draft.rules.filter(isRuleComplete);

// Detail is stored per source calendar, so every rule sharing a "from" must agree.
const sharedDetail = (rules: SetupRule[], fromId: string): DetailChoice | undefined =>
  rules.find((rule) => rule.fromId === fromId)?.detail;

const fillsBlank = (blank: SetupBlank, calendar: CalendarSource): boolean =>
  blank.kind === "from" ? canPull(calendar) : canPush(calendar);

const withRules = (draft: SetupDraft, rules: SetupRule[]): SetupDraft => ({ ...draft, rules });

const withoutId = (ids: string[], id: string): string[] => ids.filter((candidate) => candidate !== id);

const placeAt = (ids: string[], index: number, id: string): string[] => {
  const rest = withoutId(ids, id);
  const at = Math.min(index, rest.length);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
};

export const addRule = (draft: SetupDraft): SetupDraft => withRules(draft, [...draft.rules, createRule()]);

export const removeRule = (draft: SetupDraft, ruleId: string): SetupDraft => {
  const rules = draft.rules.filter((rule) => rule.id !== ruleId);
  return {
    ...draft,
    pending: draft.pending?.ruleId === ruleId ? null : draft.pending,
    rules: rules.length > 0 ? rules : [createRule()],
  };
};

export const setBlank = (
  draft: SetupDraft,
  ruleId: string,
  blank: SetupBlank,
  calendarId: string,
): SetupDraft =>
  withRules(draft, draft.rules.map((rule) => {
    if (rule.id !== ruleId) return rule;
    if (blank.kind === "from") {
      return {
        ...rule,
        detail: sharedDetail(draft.rules, calendarId) ?? rule.detail,
        fromId: calendarId,
        toIds: withoutId(rule.toIds, calendarId),
      };
    }
    return {
      ...rule,
      fromId: rule.fromId === calendarId ? null : rule.fromId,
      toIds: placeAt(rule.toIds, blank.index, calendarId),
    };
  }));

export const removeDestination = (draft: SetupDraft, ruleId: string, calendarId: string): SetupDraft =>
  withRules(draft, draft.rules.map((rule) =>
    rule.id === ruleId ? { ...rule, toIds: withoutId(rule.toIds, calendarId) } : rule));

export const setRuleDetail = (draft: SetupDraft, ruleId: string, detail: DetailChoice): SetupDraft => {
  const target = draft.rules.find((rule) => rule.id === ruleId);
  if (!target) return draft;
  const affects = (rule: SetupRule) =>
    rule.id === ruleId || (target.fromId !== null && rule.fromId === target.fromId);
  return withRules(draft, draft.rules.map((rule) => (affects(rule) ? { ...rule, detail } : rule)));
};

const hasPair = (rules: SetupRule[], fromId: string, toId: string): boolean =>
  rules.some((rule) => rule.fromId === fromId && rule.toIds.includes(toId));

// Every destination that can send back to the source and does not already.
const missingReverses = (
  draft: SetupDraft,
  ruleId: string,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): { fromId: string; toId: string }[] => {
  const rule = draft.rules.find((candidate) => candidate.id === ruleId);
  if (!rule || !isRuleComplete(rule)) return [];
  const from = calendarsById.get(rule.fromId);
  if (!from || !canPush(from)) return [];
  return rule.toIds
    .filter((toId) => {
      const to = calendarsById.get(toId);
      return to !== undefined && canPull(to) && !hasPair(draft.rules, toId, rule.fromId);
    })
    .map((toId) => ({ fromId: toId, toId: rule.fromId }));
};

export const canReverse = (
  draft: SetupDraft,
  ruleId: string,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): boolean => missingReverses(draft, ruleId, calendarsById).length > 0;

export const addReverseRule = (
  draft: SetupDraft,
  ruleId: string,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): SetupDraft => {
  const index = draft.rules.findIndex((rule) => rule.id === ruleId);
  const reverses = missingReverses(draft, ruleId, calendarsById).map(({ fromId, toId }) =>
    createRule(fromId, [toId], sharedDetail(draft.rules, fromId)));
  if (reverses.length === 0) return draft;
  const rules = [...draft.rules.slice(0, index + 1), ...reverses, ...draft.rules.slice(index + 1)];
  return withRules(draft, rules);
};

export const markPending = (draft: SetupDraft, ruleId: string, blank: SetupBlank): SetupDraft => ({
  ...draft,
  pending: { blank, ruleId },
});

export const clearPending = (draft: SetupDraft): SetupDraft =>
  draft.pending === null ? draft : { ...draft, pending: null };

export const takenIds = (rule: SetupRule, blank: SetupBlank): string[] => {
  if (blank.kind === "from") return rule.toIds;
  const own = rule.toIds[blank.index];
  const others = own === undefined ? rule.toIds : withoutId(rule.toIds, own);
  return rule.fromId === null ? others : [rule.fromId, ...others];
};

const pickCalendar = (
  calendars: CalendarSource[],
  blank: SetupBlank,
  excludeIds: string[],
): CalendarSource | undefined =>
  calendars.find((calendar) => fillsBlank(blank, calendar) && !excludeIds.includes(calendar.id));

const firstEmptyBlank = (rules: SetupRule[]): SetupPending | null => {
  const from = rules.find((rule) => rule.fromId === null);
  if (from) return { blank: { kind: "from" }, ruleId: from.id };
  const to = rules.find((rule) => rule.toIds.length === 0);
  if (to) return { blank: { index: 0, kind: "to" }, ruleId: to.id };
  return null;
};

// Fills the blank the user left to connect this account, or the first empty one, or a fresh rule.
export const resolveConnectedAccount = (
  draft: SetupDraft,
  sources: CalendarSource[],
  accountId: string,
): SetupDraft => {
  const calendars = sources.filter((source) => source.accountId === accountId);
  const cleared = clearPending(draft);
  const slot = draft.pending ?? firstEmptyBlank(draft.rules);

  if (slot) {
    const rule = draft.rules.find((candidate) => candidate.id === slot.ruleId);
    const calendar = rule && pickCalendar(calendars, slot.blank, takenIds(rule, slot.blank));
    return calendar ? setBlank(cleared, slot.ruleId, slot.blank, calendar.id) : cleared;
  }

  const calendar = pickCalendar(calendars, { kind: "from" }, []);
  return calendar ? withRules(cleared, [...cleared.rules, createRule(calendar.id)]) : cleared;
};

export const resolveNewAccountDraft = (sources: CalendarSource[], accountId: string): SetupDraft =>
  resolveConnectedAccount(createEmptyDraft(), sources, accountId);

export const pruneStaleIds = (draft: SetupDraft, sources: CalendarSource[]): SetupDraft => {
  const known = new Set(sources.map((source) => source.id));
  const rules = draft.rules.map((rule) => ({
    ...rule,
    fromId: rule.fromId !== null && known.has(rule.fromId) ? rule.fromId : null,
    toIds: rule.toIds.filter((id) => known.has(id)),
  }));
  const changed = rules.some((rule, index) =>
    rule.fromId !== draft.rules[index]?.fromId || rule.toIds.length !== draft.rules[index]?.toIds.length);
  return changed ? withRules(draft, rules) : draft;
};

export const removeRulesFrom = (draft: SetupDraft, fromId: string): SetupDraft => {
  const rules = draft.rules.filter((rule) => !(rule.fromId === fromId && isRuleComplete(rule)));
  if (rules.length === draft.rules.length) return draft;
  return withRules(draft, rules.length > 0 ? rules : [createRule()]);
};
