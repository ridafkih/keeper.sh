import { type } from "arktype";
import {
  ruleActionSchema,
  ruleConditionSchema,
  ruleMatchSchema,
  ruleNameSchema,
} from "./rules";
import type { RuleAction, RuleCondition, RuleMatch } from "./rules";

const SYNC_NAME_MAX_LENGTH = 80;
const BUSY_TITLE_MAX_LENGTH = 200;
const SKIP_KEYWORD_MAX_LENGTH = 100;
const MAX_SKIP_KEYWORDS = 50;
const MAX_ADVANCED_RULES = 20;
const MAX_RULE_CONDITIONS = 10;
const MAX_RULE_ACTIONS = 5;
const MAX_SYNC_CALENDARS = 50;
const MAX_BOTH_WAYS_MEMBERS = 8;
const DEFAULT_BUSY_TITLE = "{{calendar_name}}";
const RULE_ID_MAX_LENGTH = 64;
const RULE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_NAME_TOKEN_PATTERN = /\{\{event_name\}\}/g;

const syncModeSchema = type("'one_way' | 'both_ways'");
type SyncMode = typeof syncModeSchema.infer;

const SYNC_AVAILABILITIES = ["busy", "free", "tentative"] as const;
const syncAvailabilitySchema = type.enumerated(...SYNC_AVAILABILITIES);
type SyncAvailability = typeof syncAvailabilitySchema.infer;

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
  "id?": `string <= ${RULE_ID_MAX_LENGTH}`,
  actions: ruleActionSchema.array().atLeastLength(1).atMostLength(MAX_RULE_ACTIONS),
  conditions: ruleConditionSchema.array().atLeastLength(1).atMostLength(MAX_RULE_CONDITIONS),
  match: ruleMatchSchema,
  name: ruleNameSchema,
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
  "skipAvailabilities?": syncAvailabilitySchema.array().atMostLength(SYNC_AVAILABILITIES.length),
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
  "expectedUpdatedAt?": "string <= 40",
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
  skipAvailabilities: SyncAvailability[];
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
  skipAvailabilities: [],
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
      return "Each calendar can only appear once.";
    }
    if (calendars.memberCalendarIds.length < 2) {
      return "Add at least two calendars.";
    }
    if (calendars.memberCalendarIds.length > MAX_BOTH_WAYS_MEMBERS) {
      return `Both ways fits up to ${MAX_BOTH_WAYS_MEMBERS} calendars.`;
    }
    return null;
  }
  if (hasDuplicates(calendars.sourceCalendarIds) || hasDuplicates(calendars.destinationCalendarIds)) {
    return "Each calendar can only appear once.";
  }
  if (calendars.sourceCalendarIds.length === 0 || calendars.destinationCalendarIds.length === 0) {
    return "Pick calendars to copy from and to.";
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

// Ids key skip tallies and the preview, so only an unused uuid survives; anything else gets a fresh one.
const normalizeAdvancedRules = (rules: readonly AdvancedRuleInput[], createId: () => string): AdvancedRule[] => {
  const used = new Set<string>();
  return rules.map((rule) => {
    let { id } = rule;
    if (!id || !RULE_ID_PATTERN.test(id) || used.has(id)) {
      id = createId();
    }
    used.add(id);
    return {
      actions: rule.actions,
      conditions: rule.conditions.map((condition) => {
        if (condition.kind === "title_contains") {
          return { kind: condition.kind, value: condition.value.trim() };
        }
        return condition;
      }),
      id,
      match: rule.match,
      name: rule.name.trim(),
    };
  });
};

const sameCalendars = (left: SyncCalendars, right: SyncCalendars): boolean =>
  left.mode === right.mode
  && JSON.stringify(left.sourceCalendarIds) === JSON.stringify(right.sourceCalendarIds)
  && JSON.stringify(left.destinationCalendarIds) === JSON.stringify(right.destinationCalendarIds)
  && JSON.stringify(left.memberCalendarIds) === JSON.stringify(right.memberCalendarIds);

const calendarLists = (calendars: SyncCalendars): string[][] => {
  if (calendars.mode === "both_ways") {
    return [calendars.memberCalendarIds];
  }
  return [calendars.sourceCalendarIds, calendars.destinationCalendarIds];
};

// A list may stay as long as it already was, so a sync made before the limit keeps its calendars.
const validateSyncCalendarLimit = (
  next: SyncCalendars,
  current: SyncCalendars | null,
  limit: number,
): string | null => {
  let before: string[][] = [];
  if (current && current.mode === next.mode) {
    before = calendarLists(current);
  }
  const over = calendarLists(next).some((list, index) => list.length > Math.max(limit, before[index]?.length ?? 0));
  if (!over) {
    return null;
  }
  if (next.mode === "both_ways") {
    return `Free plans sync up to ${limit} calendars both ways.`;
  }
  return `Free plans copy from up to ${limit} calendars into up to ${limit}.`;
};

const normalizeSkipAvailabilities = (availabilities: readonly SyncAvailability[]): SyncAvailability[] =>
  SYNC_AVAILABILITIES.filter((availability) => availabilities.includes(availability));

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
const SKIP_AVAILABILITY_RULE_ID = "skip:availability";
const SKIP_KEYWORDS_RULE_ID = "skip:keywords";
const SHARE_AS_RULE_ID = "share";

const SKIP: RuleAction[] = [{ kind: "skip" }];

const withoutEventName = (template: string): string => template.replace(EVENT_NAME_TOKEN_PATTERN, "").trim();

const shareAsActions = (shareAs: ShareAs, busyTitle: string | null): RuleAction[] => {
  if (shareAs === "busy_only") {
    return [
      { kind: "rename", template: withoutEventName(busyTitle ?? "") || DEFAULT_BUSY_TITLE },
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

// A rule starts from Share As, so what Share As hides stays hidden; the rule's own rename replaces Share As's.
// Under Busy Only that rename can't bring the event's own title back.
const onShareAs = (actions: RuleAction[], shareAs: ShareAs, shareAsRules: RuleAction[]): RuleAction[] => {
  const renames = actions.some((action) => action.kind === "rename");
  const own = actions.map((action): RuleAction => {
    if (shareAs === "busy_only" && action.kind === "rename") {
      return { kind: "rename", template: withoutEventName(action.template) || DEFAULT_BUSY_TITLE };
    }
    return action;
  });
  return [...shareAsRules.filter((action) => !renames || action.kind !== "rename"), ...own];
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
  const availabilities = normalizeSkipAvailabilities(settings.skipAvailabilities);
  if (availabilities.length > 0) {
    rules.push({
      actions: SKIP,
      conditions: availabilities.map((kind) => ({ kind })),
      id: SKIP_AVAILABILITY_RULE_ID,
      match: "any",
      name: "Statuses",
    });
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
  const shareAs = shareAsActions(settings.shareAs, settings.busyTitle);
  for (const rule of settings.rules) {
    if (rule.conditions.length > 0 && rule.actions.length > 0) {
      rules.push({ ...rule, actions: withPrivacy(onShareAs(rule.actions, settings.shareAs, shareAs), settings.markPrivate) });
    }
  }
  rules.push({
    actions: withPrivacy(shareAs, settings.markPrivate),
    conditions: [],
    id: SHARE_AS_RULE_ID,
    match: "all",
    name: "Share As",
  });
  return rules;
};

const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, nested: unknown) => {
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const keys = Object.keys(nested);
    keys.sort();
    return Object.fromEntries(keys.map((key) => [key, (nested as Record<string, unknown>)[key]]));
  }
  return nested;
});

const withoutProSettings = <TSettings extends SyncSettings>(settings: TSettings): TSettings => ({
  ...settings,
  busyTitle: DEFAULT_SYNC_SETTINGS.busyTitle,
  markPrivate: DEFAULT_SYNC_SETTINGS.markPrivate,
  rules: DEFAULT_SYNC_SETTINGS.rules,
  shareAs: DEFAULT_SYNC_SETTINGS.shareAs,
  skipAllDay: DEFAULT_SYNC_SETTINGS.skipAllDay,
  skipAvailabilities: DEFAULT_SYNC_SETTINGS.skipAvailabilities,
  skipFocusTime: DEFAULT_SYNC_SETTINGS.skipFocusTime,
  skipOutOfOffice: DEFAULT_SYNC_SETTINGS.skipOutOfOffice,
  skipTitleKeywords: DEFAULT_SYNC_SETTINGS.skipTitleKeywords,
});

const PRO_TOGGLES = ["markPrivate", "skipAllDay", "skipFocusTime", "skipOutOfOffice"] as const;

// Free plans may keep, and take away from, the Pro settings a sync already has, but not add new ones.
const addsProSettings = (current: SyncSettings | null, next: SyncSettings): boolean => {
  const keep = current ?? DEFAULT_SYNC_SETTINGS;
  if (next.shareAs !== DEFAULT_SYNC_SETTINGS.shareAs && next.shareAs !== keep.shareAs) {
    return true;
  }
  if (next.busyTitle !== DEFAULT_SYNC_SETTINGS.busyTitle && next.busyTitle !== keep.busyTitle) {
    return true;
  }
  if (PRO_TOGGLES.some((key) => next[key] && !keep[key])) {
    return true;
  }
  if (next.skipAvailabilities.some((availability) => !keep.skipAvailabilities.includes(availability))) {
    return true;
  }
  const keywords = new Set(keep.skipTitleKeywords.map((keyword) => keyword.toLocaleLowerCase()));
  if (next.skipTitleKeywords.some((keyword) => !keywords.has(keyword.toLocaleLowerCase()))) {
    return true;
  }
  const rules = new Set(keep.rules.map((rule) => canonicalJson(rule)));
  return next.rules.some((rule) => !rules.has(canonicalJson(rule)));
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
  | { kind: "status_skip_changed"; status: SyncAvailability; to: boolean }
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
  const present = new Set(from);
  return keywords.filter((keyword) => !present.has(keyword));
};

const diffSkips = (previous: SyncSettings, next: SyncSettings): SyncChange[] => [
  ...SKIP_KEYS
    .filter(([, key]) => previous[key] !== next[key])
    .map(([skip, key]): SyncChange => ({ kind: "skip_changed", skip, to: next[key] })),
  ...SYNC_AVAILABILITIES
    .filter((status) => previous.skipAvailabilities.includes(status) !== next.skipAvailabilities.includes(status))
    .map((status): SyncChange => ({ kind: "status_skip_changed", status, to: next.skipAvailabilities.includes(status) })),
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
  if (canonicalJson(previous.rules) !== canonicalJson(next.rules)) {
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

type SyncCalendarProblem = "reauth" | "disabled" | "failing";

interface SyncDestinationStatus {
  calendarId: string;
  copiedCount: number;
  lastSyncedAt: string | null;
  problem: SyncCalendarProblem | null;
  skippedCount: number;
}

interface SyncSourceStatus {
  calendarId: string;
  problem: SyncCalendarProblem | null;
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
  sources: SyncSourceStatus[];
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

// Added and removed are the window's daily totals; skipped is where the sync's pairs stand now.
interface SyncActivitySummary {
  added: number;
  removed: number;
  skipped: number;
  skippedBy: SyncRunRecord["skippedBy"];
}

interface SyncActivityPage {
  entries: SyncActivityEntry[];
  nextCursor: string | null;
  // Only on the first page, so paging back doesn't recount the window.
  summary: SyncActivitySummary | null;
}

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
  MAX_RULE_ACTIONS,
  MAX_RULE_CONDITIONS,
  MAX_SKIP_KEYWORDS,
  MAX_SYNC_CALENDARS,
  SHARE_AS_RULE_ID,
  SKIP_ALL_DAY_RULE_ID,
  SKIP_AVAILABILITY_RULE_ID,
  SKIP_FOCUS_TIME_RULE_ID,
  SKIP_KEYWORDS_RULE_ID,
  SKIP_KEYWORD_MAX_LENGTH,
  SKIP_OUT_OF_OFFICE_RULE_ID,
  SYNC_AVAILABILITIES,
  SYNC_NAME_MAX_LENGTH,
  addsProSettings,
  compileSyncRules,
  createSyncBodySchema,
  deriveSyncPairs,
  diffSyncChanges,
  normalizeAdvancedRules,
  normalizeSkipAvailabilities,
  normalizeSkipKeywords,
  normalizeSyncCalendars,
  patchSyncBodySchema,
  resolveSyncState,
  sameCalendars,
  shareAsActions,
  syncCalendarIds,
  syncNameSchema,
  toShareAs,
  toSyncMode,
  validateSyncCalendarLimit,
  validateSyncCalendars,
  withoutProSettings,
};
export type {
  AdvancedRule,
  AdvancedRuleInput,
  CompiledSyncRule,
  CreateSyncBody,
  PatchSyncBody,
  ShareAs,
  SyncActivityEntry,
  SyncActivityPage,
  SyncAvailability,
  SyncActivitySummary,
  SyncCalendarRole,
  SyncCalendars,
  SyncChange,
  SyncCalendarProblem,
  SyncConflict,
  SyncDefinition,
  SyncDestinationStatus,
  SyncDetail,
  SyncMode,
  SyncPair,
  SyncRunRecord,
  SyncSettings,
  SyncSkip,
  SyncSourceStatus,
  SyncState,
  SyncSummary,
};
