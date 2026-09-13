import type { CalendarSource } from "@/types/api";
import { canPull, canPush } from "@/utils/calendars";

export type DetailChoice = "calendar_name" | "busy" | "titles";
export type BlankKind = "from" | "to";

export interface SetupRule {
  id: string;
  fromId: string | null;
  toId: string | null;
  detail: DetailChoice;
}

export interface SetupPending {
  ruleId: string;
  blank: BlankKind;
}

export interface SetupDraft {
  version: 1;
  rules: SetupRule[];
  pending: SetupPending | null;
}

export type CompleteRule = SetupRule & { fromId: string; toId: string };

const DRAFT_VERSION = 1;
const DEFAULT_DETAIL: DetailChoice = "calendar_name";

const createRule = (fromId: string | null = null, toId: string | null = null, detail: DetailChoice = DEFAULT_DETAIL): SetupRule => ({
  detail,
  fromId,
  id: crypto.randomUUID(),
  toId,
});

export const createEmptyDraft = (): SetupDraft => ({
  pending: null,
  rules: [createRule()],
  version: DRAFT_VERSION,
});

export const isRuleComplete = (rule: SetupRule): rule is CompleteRule =>
  Boolean(rule.fromId && rule.toId);

export const completeRules = (draft: SetupDraft): CompleteRule[] => draft.rules.filter(isRuleComplete);

// Detail is stored per source calendar, so every rule sharing a "from" must agree.
const sharedDetail = (rules: SetupRule[], fromId: string): DetailChoice | undefined =>
  rules.find((rule) => rule.fromId === fromId)?.detail;

const fillsBlank = (blank: BlankKind, calendar: CalendarSource): boolean =>
  blank === "from" ? canPull(calendar) : canPush(calendar);

const withRules = (draft: SetupDraft, rules: SetupRule[]): SetupDraft => ({ ...draft, rules });

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
  blank: BlankKind,
  calendarId: string,
): SetupDraft =>
  withRules(draft, draft.rules.map((rule) => {
    if (rule.id !== ruleId) return rule;
    if (blank === "from") {
      return {
        ...rule,
        detail: sharedDetail(draft.rules, calendarId) ?? rule.detail,
        fromId: calendarId,
        toId: rule.toId === calendarId ? null : rule.toId,
      };
    }
    return {
      ...rule,
      fromId: rule.fromId === calendarId ? null : rule.fromId,
      toId: calendarId,
    };
  }));

export const setRuleDetail = (draft: SetupDraft, ruleId: string, detail: DetailChoice): SetupDraft => {
  const target = draft.rules.find((rule) => rule.id === ruleId);
  if (!target) return draft;
  const affects = (rule: SetupRule) =>
    rule.id === ruleId || (target.fromId !== null && rule.fromId === target.fromId);
  return withRules(draft, draft.rules.map((rule) => (affects(rule) ? { ...rule, detail } : rule)));
};

const hasReverse = (rules: SetupRule[], rule: CompleteRule): boolean =>
  rules.some((candidate) => candidate.fromId === rule.toId && candidate.toId === rule.fromId);

export const canReverse = (
  draft: SetupDraft,
  ruleId: string,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): boolean => {
  const rule = draft.rules.find((candidate) => candidate.id === ruleId);
  if (!rule || !isRuleComplete(rule)) return false;
  const from = calendarsById.get(rule.fromId);
  const to = calendarsById.get(rule.toId);
  if (!from || !to) return false;
  return canPush(from) && canPull(to) && !hasReverse(draft.rules, rule);
};

export const addReverseRule = (draft: SetupDraft, ruleId: string): SetupDraft => {
  const index = draft.rules.findIndex((rule) => rule.id === ruleId);
  const rule = draft.rules[index];
  if (!rule || !isRuleComplete(rule) || hasReverse(draft.rules, rule)) return draft;
  const reverse = createRule(rule.toId, rule.fromId, sharedDetail(draft.rules, rule.toId));
  const rules = [...draft.rules.slice(0, index + 1), reverse, ...draft.rules.slice(index + 1)];
  return withRules(draft, rules);
};

export const markPending = (draft: SetupDraft, ruleId: string, blank: BlankKind): SetupDraft => ({
  ...draft,
  pending: { blank, ruleId },
});

export const clearPending = (draft: SetupDraft): SetupDraft =>
  draft.pending === null ? draft : { ...draft, pending: null };

const otherSideId = (rule: SetupRule, blank: BlankKind): string | null =>
  blank === "from" ? rule.toId : rule.fromId;

const pickCalendar = (
  calendars: CalendarSource[],
  blank: BlankKind,
  excludeId: string | null,
): CalendarSource | undefined =>
  calendars.find((calendar) => fillsBlank(blank, calendar) && calendar.id !== excludeId);

const firstEmptyBlank = (rules: SetupRule[]): SetupPending | null => {
  const from = rules.find((rule) => rule.fromId === null);
  if (from) return { blank: "from", ruleId: from.id };
  const to = rules.find((rule) => rule.toId === null);
  if (to) return { blank: "to", ruleId: to.id };
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
    const calendar = rule && pickCalendar(calendars, slot.blank, otherSideId(rule, slot.blank));
    return calendar ? setBlank(cleared, slot.ruleId, slot.blank, calendar.id) : cleared;
  }

  const calendar = pickCalendar(calendars, "from", null);
  return calendar ? withRules(cleared, [...cleared.rules, createRule(calendar.id)]) : cleared;
};

export const resolveNewAccountDraft = (sources: CalendarSource[], accountId: string): SetupDraft =>
  resolveConnectedAccount(createEmptyDraft(), sources, accountId);

export const pruneStaleIds = (draft: SetupDraft, sources: CalendarSource[]): SetupDraft => {
  const known = new Set(sources.map((source) => source.id));
  const keep = (id: string | null) => (id !== null && known.has(id) ? id : null);
  const rules = draft.rules.map((rule) => ({ ...rule, fromId: keep(rule.fromId), toId: keep(rule.toId) }));
  const changed = rules.some((rule, index) =>
    rule.fromId !== draft.rules[index]?.fromId || rule.toId !== draft.rules[index]?.toId);
  return changed ? withRules(draft, rules) : draft;
};

export const removeRulesFrom = (draft: SetupDraft, fromId: string): SetupDraft => {
  const rules = draft.rules.filter((rule) => !(rule.fromId === fromId && isRuleComplete(rule)));
  if (rules.length === draft.rules.length) return draft;
  return withRules(draft, rules.length > 0 ? rules : [createRule()]);
};
