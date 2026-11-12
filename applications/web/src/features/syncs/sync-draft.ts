import {
  BUSY_TITLE_MAX_LENGTH,
  DEFAULT_SYNC_SETTINGS,
  MAX_ADVANCED_RULES,
  MAX_BOTH_WAYS_MEMBERS,
  MAX_SKIP_KEYWORDS,
  MAX_SYNC_CALENDARS,
  SKIP_KEYWORD_MAX_LENGTH,
  SYNC_NAME_MAX_LENGTH,
  deriveSyncPairs,
  syncCalendarIds,
  validateSyncCalendarLimit,
  validateSyncCalendars,
  withoutProSettings,
} from "@keeper.sh/data-schemas";
import type {
  AdvancedRule,
  CreateSyncBody,
  PatchSyncBody,
  SyncCalendarRole,
  SyncCalendars,
  SyncDefinition,
  SyncAvailability,
  SyncMode,
  SyncSkip,
} from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import { canPull, canPush } from "@/utils/calendars";
import { ruleProblem } from "./rule-editing";
import { SKIP_LABELS, STATUS_LABELS, calendarName, summarizeSync, type CalendarsById } from "./syncs";
import { SYNC_TEMPLATES, isSyncTemplateKey, type SyncTemplateKey } from "./templates";

export interface SyncDraft extends SyncDefinition {
  template: SyncTemplateKey | null;
}

// Name and Pause apply the moment they change, so a draft's pending edits never carry them.
export type SyncEdits = Partial<Omit<SyncDefinition, "name" | "paused">>;

export interface DraftPlan {
  // A viewer who can't add Pro settings gets drafts without them, so the server never refuses what a profile filled in.
  locked?: boolean;
}

export interface NewSyncSearch {
  from?: string;
  profile?: SyncTemplateKey;
}

export const readNewSyncSearch = (search: Record<string, unknown>): NewSyncSearch => ({
  from: typeof search.from === "string" ? search.from : undefined,
  profile: isSyncTemplateKey(search.profile) ? search.profile : undefined,
});

type CalendarList = "destinationCalendarIds" | "memberCalendarIds" | "sourceCalendarIds";

const LIST_FOR_ROLE: Record<SyncCalendarRole, CalendarList> = {
  destination: "destinationCalendarIds",
  member: "memberCalendarIds",
  source: "sourceCalendarIds",
};

const OPPOSITE_LIST: Partial<Record<SyncCalendarRole, CalendarList>> = {
  destination: "sourceCalendarIds",
  source: "destinationCalendarIds",
};

export const createSyncDraft = (
  template: SyncTemplateKey | null = null,
  overrides: Partial<SyncDefinition> = {},
  { locked = false }: DraftPlan = {},
): SyncDraft => {
  const draft: SyncDraft = {
    ...DEFAULT_SYNC_SETTINGS,
    destinationCalendarIds: [],
    memberCalendarIds: [],
    mode: "one_way",
    name: template ? SYNC_TEMPLATES[template].name : "",
    paused: false,
    sourceCalendarIds: [],
    ...(template ? SYNC_TEMPLATES[template].values : {}),
    ...overrides,
    template,
  };
  return locked ? withoutProSettings(draft) : draft;
};

export const fitsRole = (calendar: CalendarSource, role: SyncCalendarRole): boolean => {
  if (role === "source") return canPull(calendar);
  if (role === "destination") return canPush(calendar);
  return canPull(calendar) && canPush(calendar);
};

export const calendarsInRole = (calendars: SyncCalendars, role: SyncCalendarRole): string[] => calendars[LIST_FOR_ROLE[role]];

const calendarFields = ({ destinationCalendarIds, memberCalendarIds, mode, sourceCalendarIds }: SyncCalendars): SyncCalendars => ({
  destinationCalendarIds,
  memberCalendarIds,
  mode,
  sourceCalendarIds,
});

// Only the calendar fields come back, so a pick merged into pending edits can't carry a stale copy of anything else.
// Adding a calendar to one end of a one-way sync takes it off the other, so a calendar never copies into itself.
export const toggleCalendar = (calendars: SyncCalendars, role: SyncCalendarRole, calendarId: string): SyncCalendars => {
  const fields = calendarFields(calendars);
  const list = LIST_FOR_ROLE[role];
  const current = fields[list];
  if (current.includes(calendarId)) {
    return { ...fields, [list]: current.filter((id) => id !== calendarId) };
  }
  const opposite = OPPOSITE_LIST[role];
  return {
    ...fields,
    [list]: [...current, calendarId],
    ...(opposite ? { [opposite]: fields[opposite].filter((id) => id !== calendarId) } : {}),
  };
};

export const switchMode = (
  calendars: SyncCalendars,
  mode: SyncMode,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): SyncCalendars => {
  if (calendars.mode === mode) return calendarFields(calendars);
  if (mode === "both_ways") {
    const members = [...new Set([...calendars.sourceCalendarIds, ...calendars.destinationCalendarIds])]
      .filter((id) => {
        const calendar = calendarsById.get(id);
        return calendar !== undefined && fitsRole(calendar, "member");
      })
      .slice(0, MAX_BOTH_WAYS_MEMBERS);
    return { destinationCalendarIds: [], memberCalendarIds: members, mode, sourceCalendarIds: [] };
  }
  const [first, ...rest] = calendars.memberCalendarIds;
  return { destinationCalendarIds: rest, memberCalendarIds: [], mode, sourceCalendarIds: first ? [first] : [] };
};

// How many calendars a role's list may hold: the schema's cap, or the plan's, though a saved list may keep its length.
export const roleCapacity = (
  role: SyncCalendarRole,
  mode: SyncMode,
  saved: SyncCalendars | null,
  calendarLimit: number | null,
): number => {
  const schemaCap = role === "member" ? MAX_BOTH_WAYS_MEMBERS : MAX_SYNC_CALENDARS;
  if (calendarLimit === null) return schemaCap;
  const kept = saved && saved.mode === mode ? calendarsInRole(saved, role).length : 0;
  return Math.min(schemaCap, Math.max(calendarLimit, kept));
};

// One two-way calendar per account keeps a new user's first sync to the calendars they actually live in.
// Free plans copy busy time with nothing skipped, so they start from the same calendars without Block My Time's skips.
export const buildFirstConnectDraft = (calendars: CalendarSource[], canUseEventFilters = true): SyncDraft | null => {
  const twoWay = calendars.filter((calendar) => fitsRole(calendar, "member") && !calendar.disabled);
  const perAccount = new Map<string, CalendarSource>();
  for (const calendar of twoWay) {
    if (!perAccount.has(calendar.accountId)) perAccount.set(calendar.accountId, calendar);
  }
  const chosen = [...perAccount.values()];
  for (const calendar of twoWay) {
    if (chosen.length >= 2) break;
    if (!chosen.includes(calendar)) chosen.push(calendar);
  }
  if (chosen.length < 2) return null;
  const memberCalendarIds = chosen.slice(0, MAX_BOTH_WAYS_MEMBERS).map((calendar) => calendar.id);
  if (!canUseEventFilters) return createSyncDraft(null, { memberCalendarIds, mode: "both_ways" });
  return createSyncDraft("block_my_time", { memberCalendarIds });
};

const defaultRoleFor = (draft: SyncDraft): SyncCalendarRole => {
  if (draft.mode === "both_ways") return "member";
  return draft.sourceCalendarIds.length === 0 ? "source" : "destination";
};

// Fills the blank the user left to connect this account, or the next useful one.
export const addConnectedCalendar = (
  draft: SyncDraft,
  calendars: CalendarSource[],
  accountId: string,
  pendingRole: SyncCalendarRole | null,
): SyncDraft => {
  const role = pendingRole ?? defaultRoleFor(draft);
  const taken = new Set(syncCalendarIds(draft));
  const calendar = calendars.find((candidate) =>
    candidate.accountId === accountId && fitsRole(candidate, role) && !taken.has(candidate.id));
  return calendar ? { ...draft, ...toggleCalendar(draft, role, calendar.id) } : draft;
};

// A newly connected calendar joins an existing sync where it can receive: a destination one way, a member both ways.
export const addCalendarToSync = (calendars: SyncCalendars, calendar: CalendarSource | undefined): SyncCalendars | null => {
  const role: SyncCalendarRole = calendars.mode === "both_ways" ? "member" : "destination";
  if (!calendar || !fitsRole(calendar, role) || syncCalendarIds(calendars).includes(calendar.id)) return null;
  return toggleCalendar(calendars, role, calendar.id);
};

export const pruneStaleIds = <TDraft extends SyncCalendars>(draft: TDraft, calendars: readonly Pick<CalendarSource, "id">[]): TDraft => {
  const known = new Set(calendars.map((calendar) => calendar.id));
  const keep = (ids: string[]) => ids.filter((id) => known.has(id));
  const next = {
    ...draft,
    destinationCalendarIds: keep(draft.destinationCalendarIds),
    memberCalendarIds: keep(draft.memberCalendarIds),
    sourceCalendarIds: keep(draft.sourceCalendarIds),
  };
  const unchanged = next.destinationCalendarIds.length === draft.destinationCalendarIds.length
    && next.memberCalendarIds.length === draft.memberCalendarIds.length
    && next.sourceCalendarIds.length === draft.sourceCalendarIds.length;
  return unchanged ? draft : next;
};

// Pending edits only hold the lists the user touched, so only those lose calendars that have since gone away.
export const pruneStaleEdits = (edits: SyncEdits, calendars: readonly Pick<CalendarSource, "id">[]): SyncEdits => {
  const known = new Set(calendars.map((calendar) => calendar.id));
  let next = edits;
  for (const list of Object.values(LIST_FOR_ROLE)) {
    const ids = edits[list];
    if (ids && ids.some((id) => !known.has(id))) next = { ...next, [list]: ids.filter((id) => known.has(id)) };
  }
  return next;
};

const calendarCountProblem = (calendars: SyncCalendars): string | null => {
  const lists = calendars.mode === "both_ways" ? [] : [calendars.sourceCalendarIds, calendars.destinationCalendarIds];
  return lists.some((ids) => ids.length > MAX_SYNC_CALENDARS) ? `Each end of a sync fits up to ${MAX_SYNC_CALENDARS} calendars.` : null;
};

const rulesProblem = (rules: readonly AdvancedRule[]): string | null => {
  if (rules.length > MAX_ADVANCED_RULES) return `A sync fits up to ${MAX_ADVANCED_RULES} advanced rules.`;
  for (const rule of rules) {
    const problem = ruleProblem(rule);
    if (problem) return problem;
  }
  return null;
};

export const keywordProblem = (keywords: readonly string[]): string | null => {
  if (keywords.length > MAX_SKIP_KEYWORDS) return `Never Copy fits up to ${MAX_SKIP_KEYWORDS} title words.`;
  if (keywords.some((keyword) => keyword.length > SKIP_KEYWORD_MAX_LENGTH)) {
    return `Title words to skip can be up to ${SKIP_KEYWORD_MAX_LENGTH} characters.`;
  }
  return null;
};

export const busyTitleProblem = (busyTitle: string | null): string | null =>
  busyTitle !== null && busyTitle.length > BUSY_TITLE_MAX_LENGTH ? `Busy titles can be up to ${BUSY_TITLE_MAX_LENGTH} characters.` : null;

export const syncNameProblem = (name: string): string | null => {
  if (name.trim().length === 0) return "Sync name can't be empty.";
  if (name.length > SYNC_NAME_MAX_LENGTH) return `Sync names can be up to ${SYNC_NAME_MAX_LENGTH} characters.`;
  return null;
};

export interface DraftLimits {
  // The plan's per-side calendar cap; null or left out means no plan limit.
  calendarLimit?: number | null;
  // The saved sync, whose calendar lists may stay as long as they already are.
  saved?: SyncCalendars | null;
}

// The same limits the API checks, each with its own reason, so Save is never enabled for a body the server refuses.
export const draftProblem = (draft: SyncDefinition, { calendarLimit = null, saved = null }: DraftLimits = {}): string | null =>
  validateSyncCalendars(draft)
  ?? calendarCountProblem(draft)
  ?? (calendarLimit === null ? null : validateSyncCalendarLimit(draft, saved, calendarLimit))
  ?? busyTitleProblem(draft.busyTitle)
  ?? keywordProblem(draft.skipTitleKeywords)
  ?? rulesProblem(draft.rules);

// Key order varies between the server's copy and the client's, so values are compared with sorted keys.
const stable = (value: unknown): string => JSON.stringify(value, (_key, nested: unknown) => {
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)));
  }
  return nested;
});

export const sameValue = (left: unknown, right: unknown): boolean => stable(left) === stable(right);

export type SyncRemoval =
  | { kind: "pair"; sourceCalendarId: string; destinationCalendarId: string }
  | { kind: "skip"; skip: SyncSkip }
  | { kind: "status"; status: SyncAvailability }
  | { kind: "keyword"; keyword: string }
  | { kind: "rule"; name: string };

const SKIP_FIELDS: [SyncSkip, "skipAllDay" | "skipFocusTime" | "skipOutOfOffice"][] = [
  ["all_day", "skipAllDay"],
  ["focus_time", "skipFocusTime"],
  ["out_of_office", "skipOutOfOffice"],
];

const pairKey = (pair: { sourceCalendarId: string; destinationCalendarId: string }): string =>
  `${pair.sourceCalendarId}::${pair.destinationCalendarId}`;

// Copies are deleted when a calendar stops copying into another, or when something new keeps events back.
export const saveRemovals = (previous: SyncDefinition, next: SyncDefinition): SyncRemoval[] => {
  const kept = new Set(deriveSyncPairs(next).map(pairKey));
  const pairs = deriveSyncPairs(previous)
    .filter((pair) => !kept.has(pairKey(pair)))
    .map((pair): SyncRemoval => ({ ...pair, kind: "pair" }));
  const skips = SKIP_FIELDS
    .filter(([, field]) => next[field] && !previous[field])
    .map(([skip]): SyncRemoval => ({ kind: "skip", skip }));
  const statuses = next.skipAvailabilities
    .filter((status) => !previous.skipAvailabilities.includes(status))
    .map((status): SyncRemoval => ({ kind: "status", status }));
  const knownKeywords = new Set(previous.skipTitleKeywords.map((keyword) => keyword.toLocaleLowerCase()));
  const keywords = next.skipTitleKeywords
    .filter((keyword) => !knownKeywords.has(keyword.toLocaleLowerCase()))
    .map((keyword): SyncRemoval => ({ keyword, kind: "keyword" }));
  const knownRules = new Set(previous.rules.map((rule) => stable(rule)));
  const rules = next.rules
    .filter((rule) => rule.actions.some((action) => action.kind === "skip") && !knownRules.has(stable(rule)))
    .map((rule): SyncRemoval => ({ kind: "rule", name: rule.name }));
  return [...pairs, ...skips, ...statuses, ...keywords, ...rules];
};

export const isRiskySave = (previous: SyncDefinition, next: SyncDefinition): boolean => saveRemovals(previous, next).length > 0;

const listNames = (names: readonly string[]): string => {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

export const describeRemovals = (removals: readonly SyncRemoval[], calendarsById: CalendarsById): string[] => {
  const fromByDestination = new Map<string, string[]>();
  const lines: string[] = [];
  for (const removal of removals) {
    if (removal.kind === "pair") {
      const sources = fromByDestination.get(removal.destinationCalendarId) ?? [];
      fromByDestination.set(removal.destinationCalendarId, [...sources, calendarName(calendarsById, removal.sourceCalendarId)]);
    }
    if (removal.kind === "skip") lines.push(`Copies of ${SKIP_LABELS[removal.skip].toLowerCase()} are removed.`);
    if (removal.kind === "status") lines.push(`Copies of ${STATUS_LABELS[removal.status].toLowerCase()} events are removed.`);
    if (removal.kind === "keyword") lines.push(`Copies of events titled “${removal.keyword}” are removed.`);
    if (removal.kind === "rule") lines.push(`Copies that ${removal.name} skips are removed.`);
  }
  const pairLines = [...fromByDestination].map(([destinationId, sources]) =>
    `Copies of ${listNames(sources)} are removed from ${calendarName(calendarsById, destinationId)}.`);
  return [...pairLines, ...lines];
};

const SAVE_KEYS = [
  "busyTitle", "destinationCalendarIds", "markPrivate", "memberCalendarIds", "mode",
  "rules", "shareAs", "skipAllDay", "skipAvailabilities", "skipFocusTime", "skipOutOfOffice", "skipTitleKeywords",
  "sourceCalendarIds",
] as const satisfies readonly (keyof PatchSyncBody & keyof SyncDefinition)[];

// Only what differs from the copy the user started from, so a save can't put back a field changed elsewhere since.
export const toPatchBody = (saved: SyncDefinition & { updatedAt: string }, draft: SyncDefinition): PatchSyncBody => {
  const body: PatchSyncBody = { expectedUpdatedAt: saved.updatedAt };
  for (const key of SAVE_KEYS) {
    if (!sameValue(saved[key], draft[key])) Object.assign(body, { [key]: draft[key] });
  }
  return body;
};

// After a save, drops the edits it carried; one changed while the request was out stays pending.
export const settleEdits = (edits: SyncEdits, sent: SyncDefinition): SyncEdits => {
  const pending: SyncEdits = {};
  for (const key of SAVE_KEYS) {
    if (key in edits && !sameValue(edits[key], sent[key])) Object.assign(pending, { [key]: edits[key] });
  }
  return pending;
};

export const draftFallbackName = (draft: SyncDefinition, calendarsById: CalendarsById): string =>
  summarizeSync(draft, calendarsById).split(" · ")[0] ?? "New sync";

export const toCreateBody = (draft: SyncDraft, fallbackName: string): CreateSyncBody => ({
  busyTitle: draft.busyTitle,
  destinationCalendarIds: draft.destinationCalendarIds,
  markPrivate: draft.markPrivate,
  memberCalendarIds: draft.memberCalendarIds,
  mode: draft.mode,
  name: (draft.name.trim() || fallbackName).slice(0, SYNC_NAME_MAX_LENGTH),
  paused: draft.paused,
  rules: draft.rules,
  shareAs: draft.shareAs,
  skipAllDay: draft.skipAllDay,
  skipAvailabilities: draft.skipAvailabilities,
  skipFocusTime: draft.skipFocusTime,
  skipOutOfOffice: draft.skipOutOfOffice,
  skipTitleKeywords: draft.skipTitleKeywords,
  sourceCalendarIds: draft.sourceCalendarIds,
});
