import { DEFAULT_SYNC_SETTINGS, MAX_BOTH_WAYS_MEMBERS, SYNC_NAME_MAX_LENGTH, validateSyncCalendars } from "@keeper.sh/data-schemas";
import type { AdvancedRule, CreateSyncBody, SyncCalendarRole, SyncCalendars, SyncChange, SyncDefinition, SyncMode } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import { canPull, canPush } from "@/utils/calendars";
import { SYNC_TEMPLATES, isSyncTemplateKey, type SyncTemplateKey } from "./templates";

export interface SyncDraft extends SyncDefinition {
  template: SyncTemplateKey | null;
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

export const createSyncDraft = (template: SyncTemplateKey | null = null, overrides: Partial<SyncDefinition> = {}): SyncDraft => ({
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
});

export const fitsRole = (calendar: CalendarSource, role: SyncCalendarRole): boolean => {
  if (role === "source") return canPull(calendar);
  if (role === "destination") return canPush(calendar);
  return canPull(calendar) && canPush(calendar);
};

export const calendarsInRole = (calendars: SyncCalendars, role: SyncCalendarRole): string[] => calendars[LIST_FOR_ROLE[role]];

// Adding a calendar to one end of a one-way sync takes it off the other, so a calendar never copies into itself.
export const toggleCalendar = <T extends SyncCalendars>(calendars: T, role: SyncCalendarRole, calendarId: string): T => {
  const list = LIST_FOR_ROLE[role];
  const current = calendars[list];
  if (current.includes(calendarId)) {
    return { ...calendars, [list]: current.filter((id) => id !== calendarId) };
  }
  const opposite = OPPOSITE_LIST[role];
  return {
    ...calendars,
    [list]: [...current, calendarId],
    ...(opposite ? { [opposite]: calendars[opposite].filter((id) => id !== calendarId) } : {}),
  };
};

export const switchMode = (
  calendars: SyncCalendars,
  mode: SyncMode,
  calendarsById: ReadonlyMap<string, CalendarSource>,
): SyncCalendars => {
  if (calendars.mode === mode) return calendars;
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

// One two-way calendar per account keeps a new user's first sync to the calendars they actually live in.
export const buildFirstConnectDraft = (calendars: CalendarSource[]): SyncDraft | null => {
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
  return createSyncDraft("block_my_time", {
    memberCalendarIds: chosen.slice(0, MAX_BOTH_WAYS_MEMBERS).map((calendar) => calendar.id),
  });
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
  const taken = new Set([...draft.sourceCalendarIds, ...draft.destinationCalendarIds, ...draft.memberCalendarIds]);
  const calendar = calendars.find((candidate) =>
    candidate.accountId === accountId && fitsRole(candidate, role) && !taken.has(candidate.id));
  return calendar ? toggleCalendar(draft, role, calendar.id) : draft;
};

export const pruneStaleIds = (draft: SyncDraft, calendars: CalendarSource[]): SyncDraft => {
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

const rulesProblem = (rules: readonly AdvancedRule[]): string | null => {
  for (const rule of rules) {
    if (rule.conditions.length === 0) return `${rule.name} needs a condition.`;
    if (rule.actions.length === 0) return `${rule.name} needs an action.`;
  }
  return null;
};

export const draftProblem = (draft: SyncCalendars & Pick<SyncDefinition, "rules">): string | null =>
  validateSyncCalendars(draft) ?? rulesProblem(draft.rules);

// Dropping a calendar or flipping direction deletes or rewrites copies, so saving it asks first.
export const isRiskySave = (changes: readonly SyncChange[]): boolean =>
  changes.some((change) => change.kind === "mode_changed" || change.kind === "calendar_removed");

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
  skipFocusTime: draft.skipFocusTime,
  skipOutOfOffice: draft.skipOutOfOffice,
  skipTitleKeywords: draft.skipTitleKeywords,
  sourceCalendarIds: draft.sourceCalendarIds,
});
