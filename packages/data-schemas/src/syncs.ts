import { type } from "arktype";
import {
  ruleActionSchema,
  ruleConditionSchema,
  ruleMatchSchema,
  syncRuleNameSchema,
} from "./sync-rules";
import type { RuleAction, RuleCondition, RuleMatch } from "./sync-rules";

const SYNC_NAME_MAX_LENGTH = 80;
const BUSY_TITLE_MAX_LENGTH = 200;
const SKIP_KEYWORD_MAX_LENGTH = 60;
const MAX_SKIP_KEYWORDS = 20;
const MAX_ADVANCED_RULES = 20;
const MAX_RULE_CONDITIONS = 10;
const MAX_RULE_ACTIONS = 5;
const MAX_SYNC_CALENDARS = 50;
const MAX_BOTH_WAYS_MEMBERS = 8;
const DEFAULT_BUSY_TITLE = "{{calendar_name}}";

const syncModeSchema = type("'one_way' | 'both_ways'");
type SyncMode = typeof syncModeSchema.infer;

const shareAsSchema = type("'busy_only' | 'title_only' | 'full'");
type ShareAs = typeof shareAsSchema.infer;

const toShareAs = (value: string): ShareAs => {
  if (value === "title_only" || value === "full") {
    return value;
  }
  return "busy_only";
};

const toSyncMode = (value: string): SyncMode => {
  if (value === "both_ways") {
    return value;
  }
  return "one_way";
};

const syncNameSchema = type(`string <= ${SYNC_NAME_MAX_LENGTH}`).narrow(
  (value) => value.trim().length > 0,
);
const skipKeywordSchema = type(`string <= ${SKIP_KEYWORD_MAX_LENGTH}`).narrow(
  (value) => value.trim().length > 0,
);
const busyTitleSchema = type(`string <= ${BUSY_TITLE_MAX_LENGTH}`).or("null");
const calendarIdsSchema = type("string[]").atMostLength(MAX_SYNC_CALENDARS);

const advancedRuleSchema = type({
  "id?": "string",
  actions: ruleActionSchema.array().atLeastLength(1).atMostLength(MAX_RULE_ACTIONS),
  conditions: ruleConditionSchema.array().atLeastLength(1).atMostLength(MAX_RULE_CONDITIONS),
  match: ruleMatchSchema,
  name: syncRuleNameSchema,
  "+": "reject",
});
type AdvancedRuleInput = typeof advancedRuleSchema.infer;

interface AdvancedRule {
  actions: RuleAction[];
  conditions: RuleCondition[];
  id: string;
  match: RuleMatch;
  name: string;
}

const syncSettingsDefinition = {
  "busyTitle?": busyTitleSchema,
  "destinationCalendarIds?": calendarIdsSchema,
  "markPrivate?": "boolean",
  "memberCalendarIds?": calendarIdsSchema,
  "paused?": "boolean",
  "rules?": advancedRuleSchema.array().atMostLength(MAX_ADVANCED_RULES),
  "shareAs?": shareAsSchema,
  "skipAllDay?": "boolean",
  "skipFocusTime?": "boolean",
  "skipOutOfOffice?": "boolean",
  "skipTitleKeywords?": skipKeywordSchema.array().atMostLength(MAX_SKIP_KEYWORDS),
  "sourceCalendarIds?": calendarIdsSchema,
} as const;

const createSyncBodySchema = type({
  ...syncSettingsDefinition,
  mode: syncModeSchema,
  name: syncNameSchema,
  "+": "reject",
});
type CreateSyncBody = typeof createSyncBodySchema.infer;

const patchSyncBodySchema = type({
  ...syncSettingsDefinition,
  "mode?": syncModeSchema,
  "name?": syncNameSchema,
  "+": "reject",
});
type PatchSyncBody = typeof patchSyncBodySchema.infer;

interface SyncCalendars {
  destinationCalendarIds: string[];
  memberCalendarIds: string[];
  mode: SyncMode;
  sourceCalendarIds: string[];
}

interface SyncSettings {
  busyTitle: string | null;
  markPrivate: boolean;
  rules: AdvancedRule[];
  shareAs: ShareAs;
  skipAllDay: boolean;
  skipFocusTime: boolean;
  skipOutOfOffice: boolean;
  skipTitleKeywords: string[];
}

interface SyncDefinition extends SyncCalendars, SyncSettings {
  name: string;
  paused: boolean;
}

const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  busyTitle: null,
  markPrivate: false,
  rules: [],
  shareAs: "busy_only",
  skipAllDay: false,
  skipFocusTime: false,
  skipOutOfOffice: false,
  skipTitleKeywords: [],
};

const hasDuplicates = (values: readonly string[]): boolean => new Set(values).size !== values.length;

const normalizeSyncCalendars = (calendars: SyncCalendars): SyncCalendars => {
  if (calendars.mode === "both_ways") {
    return {
      destinationCalendarIds: [],
      memberCalendarIds: calendars.memberCalendarIds,
      mode: "both_ways",
      sourceCalendarIds: [],
    };
  }
  return {
    destinationCalendarIds: calendars.destinationCalendarIds,
    memberCalendarIds: [],
    mode: "one_way",
    sourceCalendarIds: calendars.sourceCalendarIds,
  };
};

const validateSyncCalendars = (calendars: SyncCalendars): string | null => {
  if (calendars.mode === "both_ways") {
    if (hasDuplicates(calendars.memberCalendarIds)) {
      return "A calendar can only appear once in a sync.";
    }
    if (calendars.memberCalendarIds.length < 2) {
      return "Add at least two calendars to keep in step.";
    }
    if (calendars.memberCalendarIds.length > MAX_BOTH_WAYS_MEMBERS) {
      return `A both-ways sync can hold up to ${MAX_BOTH_WAYS_MEMBERS} calendars.`;
    }
    return null;
  }
  if (hasDuplicates(calendars.sourceCalendarIds) || hasDuplicates(calendars.destinationCalendarIds)) {
    return "A calendar can only appear once in a sync.";
  }
  if (calendars.sourceCalendarIds.length === 0 || calendars.destinationCalendarIds.length === 0) {
    return "Pick at least one calendar to copy from and one to copy to.";
  }
  const sources = new Set(calendars.sourceCalendarIds);
  if (calendars.destinationCalendarIds.some((calendarId) => sources.has(calendarId))) {
    return "A calendar can't copy into itself.";
  }
  return null;
};

const normalizeSkipKeywords = (keywords: readonly string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const keyword of keywords) {
    const trimmed = keyword.trim();
    const key = trimmed.toLocaleLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      normalized.push(trimmed);
    }
  }
  return normalized;
};

interface SyncPair {
  destinationCalendarId: string;
  sourceCalendarId: string;
}

const pairEnds = (calendars: SyncCalendars): { destinations: string[]; sources: string[] } => {
  if (calendars.mode === "both_ways") {
    return { destinations: calendars.memberCalendarIds, sources: calendars.memberCalendarIds };
  }
  return { destinations: calendars.destinationCalendarIds, sources: calendars.sourceCalendarIds };
};

const deriveSyncPairs = (calendars: SyncCalendars): SyncPair[] => {
  const { destinations, sources } = pairEnds(calendars);
  const pairs: SyncPair[] = [];
  for (const sourceCalendarId of sources) {
    for (const destinationCalendarId of destinations) {
      if (sourceCalendarId !== destinationCalendarId) {
        pairs.push({ destinationCalendarId, sourceCalendarId });
      }
    }
  }
  return pairs;
};

const syncCalendarIds = (calendars: SyncCalendars): string[] => [
  ...new Set([...calendars.sourceCalendarIds, ...calendars.destinationCalendarIds, ...calendars.memberCalendarIds]),
];

interface CompiledSyncRule {
  actions: RuleAction[];
  conditions: RuleCondition[];
  id: string;
  match: RuleMatch;
  name: string;
}

const SKIP_ALL_DAY_RULE_ID = "skip:all_day";
const SKIP_FOCUS_TIME_RULE_ID = "skip:focus_time";
const SKIP_OUT_OF_OFFICE_RULE_ID = "skip:out_of_office";
const SKIP_KEYWORDS_RULE_ID = "skip:keywords";
const SHARE_AS_RULE_ID = "share";

const SKIP: RuleAction[] = [{ kind: "skip" }];

const shareAsActions = (shareAs: ShareAs, busyTitle: string | null): RuleAction[] => {
  if (shareAs === "busy_only") {
    return [
      { kind: "rename", template: busyTitle?.trim() || DEFAULT_BUSY_TITLE },
      { kind: "drop_description" },
      { kind: "drop_location" },
    ];
  }
  if (shareAs === "title_only") {
    return [{ kind: "drop_description" }, { kind: "drop_location" }];
  }
  return [];
};

// Private applies to every copy, so a rule that reshapes an event can't make it public.
const withPrivacy = (actions: RuleAction[], markPrivate: boolean): RuleAction[] => {
  if (!markPrivate || actions.some((action) => action.kind === "skip" || action.kind === "mark_private")) {
    return actions;
  }
  return [...actions, { kind: "mark_private" }];
};

// Never Copy first so a skip toggle is a guarantee; Share As last so nothing lands behind the catch-all.
const compileSyncRules = (settings: SyncSettings): CompiledSyncRule[] => {
  const rules: CompiledSyncRule[] = [];
  if (settings.skipAllDay) {
    rules.push({ actions: SKIP, conditions: [{ kind: "all_day" }], id: SKIP_ALL_DAY_RULE_ID, match: "all", name: "All-day events" });
  }
  if (settings.skipFocusTime) {
    rules.push({ actions: SKIP, conditions: [{ kind: "focus_time" }], id: SKIP_FOCUS_TIME_RULE_ID, match: "all", name: "Focus time" });
  }
  if (settings.skipOutOfOffice) {
    rules.push({ actions: SKIP, conditions: [{ kind: "out_of_office" }], id: SKIP_OUT_OF_OFFICE_RULE_ID, match: "all", name: "Out of office" });
  }
  const keywords = normalizeSkipKeywords(settings.skipTitleKeywords);
  if (keywords.length > 0) {
    rules.push({
      actions: SKIP,
      conditions: keywords.map((value) => ({ kind: "title_contains", value })),
      id: SKIP_KEYWORDS_RULE_ID,
      match: "any",
      name: "Titled words",
    });
  }
  for (const rule of settings.rules) {
    if (rule.conditions.length > 0) {
      rules.push({ ...rule, actions: withPrivacy(rule.actions, settings.markPrivate) });
    }
  }
  rules.push({
    actions: withPrivacy(shareAsActions(settings.shareAs, settings.busyTitle), settings.markPrivate),
    conditions: [],
    id: SHARE_AS_RULE_ID,
    match: "all",
    name: "Share As",
  });
  return rules;
};

type SyncSkip = "all_day" | "focus_time" | "out_of_office";
type SyncCalendarRole = "source" | "destination" | "member";

type SyncChange =
  | { kind: "created" }
  | { kind: "renamed"; from: string; to: string }
  | { kind: "mode_changed"; to: SyncMode }
  | { kind: "share_as_changed"; from: ShareAs; to: ShareAs }
  | { kind: "busy_title_changed" }
  | { kind: "private_changed"; to: boolean }
  | { kind: "skip_changed"; skip: SyncSkip; to: boolean }
  | { kind: "keyword_added" | "keyword_removed"; keyword: string }
  | { kind: "calendar_added" | "calendar_removed"; calendarId: string; role: SyncCalendarRole }
  | { kind: "rules_changed" }
  | { kind: "paused" | "resumed" };

const calendarRoles = (calendars: SyncCalendars): Map<string, SyncCalendarRole> => {
  const roles = new Map<string, SyncCalendarRole>();
  const lists: [SyncCalendarRole, string[]][] = [
    ["source", calendars.sourceCalendarIds],
    ["destination", calendars.destinationCalendarIds],
    ["member", calendars.memberCalendarIds],
  ];
  for (const [role, calendarIds] of lists) {
    for (const calendarId of calendarIds) {
      roles.set(calendarId, role);
    }
  }
  return roles;
};

const diffCalendars = (previous: SyncCalendars, next: SyncCalendars): SyncChange[] => {
  if (previous.mode !== next.mode) {
    return [{ kind: "mode_changed", to: next.mode }];
  }
  const before = calendarRoles(previous);
  const after = calendarRoles(next);
  const changes: SyncChange[] = [];
  for (const [calendarId, role] of after) {
    if (before.get(calendarId) !== role) {
      changes.push({ calendarId, kind: "calendar_added", role });
    }
  }
  for (const [calendarId, role] of before) {
    if (after.get(calendarId) !== role) {
      changes.push({ calendarId, kind: "calendar_removed", role });
    }
  }
  return changes;
};

const SKIP_KEYS: [SyncSkip, "skipAllDay" | "skipFocusTime" | "skipOutOfOffice"][] = [
  ["all_day", "skipAllDay"],
  ["focus_time", "skipFocusTime"],
  ["out_of_office", "skipOutOfOffice"],
];

const missingKeywords = (keywords: readonly string[], from: readonly string[]): string[] => {
  const present = new Set(from.map((keyword) => keyword.toLocaleLowerCase()));
  return keywords.filter((keyword) => !present.has(keyword.toLocaleLowerCase()));
};

const diffSkips = (previous: SyncSettings, next: SyncSettings): SyncChange[] => [
  ...SKIP_KEYS
    .filter(([, key]) => previous[key] !== next[key])
    .map(([skip, key]): SyncChange => ({ kind: "skip_changed", skip, to: next[key] })),
  ...missingKeywords(next.skipTitleKeywords, previous.skipTitleKeywords)
    .map((keyword): SyncChange => ({ keyword, kind: "keyword_added" })),
  ...missingKeywords(previous.skipTitleKeywords, next.skipTitleKeywords)
    .map((keyword): SyncChange => ({ keyword, kind: "keyword_removed" })),
];

const diffSharing = (previous: SyncSettings, next: SyncSettings): SyncChange[] => {
  const changes: SyncChange[] = [];
  if (previous.shareAs !== next.shareAs) {
    changes.push({ from: previous.shareAs, kind: "share_as_changed", to: next.shareAs });
  }
  if (previous.busyTitle !== next.busyTitle) {
    changes.push({ kind: "busy_title_changed" });
  }
  if (previous.markPrivate !== next.markPrivate) {
    changes.push({ kind: "private_changed", to: next.markPrivate });
  }
  if (JSON.stringify(previous.rules) !== JSON.stringify(next.rules)) {
    changes.push({ kind: "rules_changed" });
  }
  return changes;
};

const diffSyncChanges = (previous: SyncDefinition | null, next: SyncDefinition): SyncChange[] => {
  if (!previous) {
    return [{ kind: "created" }];
  }
  const changes: SyncChange[] = [];
  if (previous.name !== next.name) {
    changes.push({ from: previous.name, kind: "renamed", to: next.name });
  }
  changes.push(...diffCalendars(previous, next), ...diffSharing(previous, next), ...diffSkips(previous, next));
  if (previous.paused && !next.paused) {
    changes.push({ kind: "resumed" });
  }
  if (!previous.paused && next.paused) {
    changes.push({ kind: "paused" });
  }
  return changes;
};

type SyncState = "ok" | "problem" | "paused" | "empty";

const resolveSyncState = (input: { hasProblem: boolean; pairCount: number; paused: boolean }): SyncState => {
  if (input.paused) {
    return "paused";
  }
  if (input.pairCount === 0) {
    return "empty";
  }
  if (input.hasProblem) {
    return "problem";
  }
  return "ok";
};

type SyncDestinationProblem = "reauth" | "disabled" | "failing";

interface SyncDestinationStatus {
  calendarId: string;
  copiedCount: number;
  lastSyncedAt: string | null;
  problem: SyncDestinationProblem | null;
  skippedCount: number;
}

interface SyncSummary extends SyncDefinition {
  copiedCount: number;
  createdAt: string;
  id: string;
  lastSyncedAt: string | null;
  pairCount: number;
  skippedCount: number;
  state: SyncState;
  updatedAt: string;
}

interface SyncDetail extends SyncSummary {
  destinations: SyncDestinationStatus[];
}

interface SyncRunRecord {
  added: number;
  copied: number;
  destinationCalendarId: string;
  failed: number;
  removed: number;
  skipped: number;
  skippedBy: { count: number; name: string; ruleId: string }[];
}

type SyncActivityEntry =
  | { change: SyncChange; createdAt: string; id: string; kind: "change" }
  | { createdAt: string; id: string; kind: "run"; run: SyncRunRecord };

interface SyncConflict {
  destinationCalendarId: string;
  sourceCalendarId: string;
  syncId: string;
  syncName: string;
}

export {
  BUSY_TITLE_MAX_LENGTH,
  DEFAULT_BUSY_TITLE,
  DEFAULT_SYNC_SETTINGS,
  MAX_ADVANCED_RULES,
  MAX_BOTH_WAYS_MEMBERS,
  MAX_SKIP_KEYWORDS,
  SHARE_AS_RULE_ID,
  SKIP_ALL_DAY_RULE_ID,
  SKIP_FOCUS_TIME_RULE_ID,
  SKIP_KEYWORDS_RULE_ID,
  SKIP_OUT_OF_OFFICE_RULE_ID,
  SYNC_NAME_MAX_LENGTH,
  advancedRuleSchema,
  compileSyncRules,
  createSyncBodySchema,
  deriveSyncPairs,
  diffSyncChanges,
  normalizeSkipKeywords,
  normalizeSyncCalendars,
  patchSyncBodySchema,
  resolveSyncState,
  shareAsActions,
  shareAsSchema,
  syncCalendarIds,
  syncModeSchema,
  syncNameSchema,
  toShareAs,
  toSyncMode,
  validateSyncCalendars,
};
export type {
  AdvancedRule,
  AdvancedRuleInput,
  CompiledSyncRule,
  CreateSyncBody,
  PatchSyncBody,
  ShareAs,
  SyncActivityEntry,
  SyncCalendarRole,
  SyncCalendars,
  SyncChange,
  SyncConflict,
  SyncDefinition,
  SyncDestinationProblem,
  SyncDestinationStatus,
  SyncDetail,
  SyncMode,
  SyncPair,
  SyncRunRecord,
  SyncSettings,
  SyncSkip,
  SyncState,
  SyncSummary,
};
