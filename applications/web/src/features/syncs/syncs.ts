import { SKIP_KEYWORDS_RULE_ID, compileSyncRules, deriveSyncPairs, evaluateRules, findMatchingRule } from "@keeper.sh/data-schemas";
import type {
  CompiledSyncRule,
  ShareAs,
  SyncCalendarRole,
  SyncCalendars,
  SyncChange,
  SyncConflict,
  SyncDefinition,
  SyncRunRecord,
  SyncSettings,
  SyncSkip,
  SyncState,
} from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";

export const SYNCS_KEY = "/api/syncs";
export const syncKey = (syncId: string): string => `/api/syncs/${syncId}`;
export const syncActivityKey = (syncId: string): string => `/api/syncs/${syncId}/activity`;
export const syncPagePath = (syncId: string): string => `/dashboard/syncs/${syncId}`;

export type CalendarsById = ReadonlyMap<string, Pick<CalendarSource, "id" | "name">>;

export const SHARE_AS_OPTIONS: { value: ShareAs; label: string; description: string }[] = [
  { description: "Just the time, named after the calendar", label: "Busy Only", value: "busy_only" },
  { description: "Keeps the title, drops notes and location", label: "Title Only", value: "title_only" },
  { description: "Copies everything", label: "Full Details", value: "full" },
];

export const shareAsLabel = (shareAs: ShareAs): string =>
  SHARE_AS_OPTIONS.find((option) => option.value === shareAs)?.label ?? "Busy Only";

export const SKIP_LABELS: Record<SyncSkip, string> = {
  all_day: "All-day events",
  focus_time: "Focus time",
  out_of_office: "Out of office",
};

const calendarName = (calendarsById: CalendarsById, calendarId: string): string =>
  calendarsById.get(calendarId)?.name ?? "a removed calendar";

const calendarNames = (calendarsById: CalendarsById, calendarIds: readonly string[]): string =>
  calendarIds.map((calendarId) => calendarName(calendarsById, calendarId)).join(", ");

export const summarizeSync = (sync: SyncCalendars & Pick<SyncSettings, "shareAs">, calendarsById: CalendarsById): string => {
  const sharing = shareAsLabel(sync.shareAs);
  if (sync.mode === "both_ways") {
    return `${calendarNames(calendarsById, sync.memberCalendarIds) || "No calendars"} · Both Ways · ${sharing}`;
  }
  const from = calendarNames(calendarsById, sync.sourceCalendarIds) || "…";
  const to = calendarNames(calendarsById, sync.destinationCalendarIds) || "…";
  return `${from} → ${to} · ${sharing}`;
};

export const roleIn = (sync: SyncCalendars, calendarId: string): string | null => {
  if (sync.memberCalendarIds.includes(calendarId)) return "Both Ways";
  if (sync.sourceCalendarIds.includes(calendarId)) return "Sends";
  if (sync.destinationCalendarIds.includes(calendarId)) return "Receives";
  return null;
};

export interface PreviewDirection {
  key: string;
  source: string;
  destinations: string[];
}

// One entry per calendar that sends, naming everywhere it copies into; a sync still missing a side gets placeholder names.
export const previewDirections = (sync: SyncCalendars, calendarsById: CalendarsById): PreviewDirection[] => {
  const bySource = new Map<string, string[]>();
  for (const { sourceCalendarId, destinationCalendarId } of deriveSyncPairs(sync)) {
    bySource.set(sourceCalendarId, [...(bySource.get(sourceCalendarId) ?? []), calendarName(calendarsById, destinationCalendarId)]);
  }
  if (bySource.size > 0) {
    return [...bySource].map(([sourceId, destinations]) => ({ destinations, key: sourceId, source: calendarName(calendarsById, sourceId) }));
  }
  const sourceId = sync.sourceCalendarIds[0] ?? sync.memberCalendarIds[0];
  const destinations = sync.destinationCalendarIds.map((calendarId) => calendarName(calendarsById, calendarId));
  return [{
    destinations: destinations.length > 0 ? destinations : [sync.mode === "both_ways" ? "the others" : "the destination"],
    key: sourceId ?? "",
    source: sourceId ? calendarName(calendarsById, sourceId) : "Your calendar",
  }];
};

export const SIDEBAR_SYNC_LIMIT = 3;

export const newestFirst = <T extends { createdAt: string; id: string }>(syncs: readonly T[]): T[] =>
  [...syncs].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));

export const STATE_LABELS: Record<SyncState, string> = {
  empty: "Add calendars to start",
  ok: "Up to date",
  paused: "Paused",
  problem: "Needs attention",
};

export const findDraftConflicts = (
  draft: SyncCalendars,
  others: readonly (SyncCalendars & { id: string; name: string })[],
): SyncConflict[] => {
  const conflicts: SyncConflict[] = [];
  const owners = new Map<string, { id: string; name: string }>();
  for (const other of others) {
    for (const pair of deriveSyncPairs(other)) {
      owners.set(`${pair.sourceCalendarId}::${pair.destinationCalendarId}`, other);
    }
  }
  for (const pair of deriveSyncPairs(draft)) {
    const owner = owners.get(`${pair.sourceCalendarId}::${pair.destinationCalendarId}`);
    if (owner) conflicts.push({ ...pair, syncId: owner.id, syncName: owner.name });
  }
  return conflicts;
};

export const describeConflicts = (conflicts: readonly SyncConflict[], calendarsById: CalendarsById): string => {
  const [first] = conflicts;
  if (!first) return "";
  const pairs = conflicts
    .map((conflict) => `${calendarName(calendarsById, conflict.sourceCalendarId)} → ${calendarName(calendarsById, conflict.destinationCalendarId)}`)
    .join(", ");
  const verb = conflicts.length > 1 ? "are" : "is";
  return `${pairs} ${verb} already in ${first.syncName}. A calendar can only copy into another through one sync.`;
};

export interface PreviewEvent {
  description?: string;
  isAllDay?: boolean;
  isFocusTime?: boolean;
  isOutOfOffice?: boolean;
  location?: string;
  time: string;
  title: string;
}

export const PREVIEW_EVENTS: PreviewEvent[] = [
  { description: "Agenda: Q4 roadmap", location: "Room 4", time: "10:00 – 10:45", title: "Design Review" },
  { description: "Career chat", location: "Café Olympia", time: "14:00 – 14:30", title: "1:1 with Priya" },
  { description: "Travel details inside", isAllDay: true, location: "Lisbon", time: "All day", title: "Company Offsite" },
  { isFocusTime: true, time: "09:00 – 11:00", title: "Focus: Write Spec" },
  { description: "Daily", location: "Zoom", time: "09:30 – 09:45", title: "Standup" },
];

const OUT_OF_OFFICE_SAMPLE: PreviewEvent = { isOutOfOffice: true, time: "13:00 – 17:00", title: "Out of Office" };

const sampleTitle = (keyword: string): string => keyword.charAt(0).toLocaleUpperCase() + keyword.slice(1);

// The fixed samples can't show a title keyword or out-of-office condition they don't happen to trigger, so each gets one of its own.
export const previewEventsFor = (settings: SyncSettings): PreviewEvent[] => {
  const events = [...PREVIEW_EVENTS];
  const titles = new Set(events.map((event) => event.title.toLocaleLowerCase()));
  for (const condition of compileSyncRules(settings).flatMap((rule) => rule.conditions)) {
    if (condition.kind === "out_of_office" && !events.some((event) => event.isOutOfOffice)) {
      events.push(OUT_OF_OFFICE_SAMPLE);
    }
    if (condition.kind !== "title_contains") continue;
    const keyword = condition.value.trim().toLocaleLowerCase();
    if (!keyword || [...titles].some((title) => title.includes(keyword))) continue;
    titles.add(keyword);
    events.push({ time: "12:00 – 12:30", title: sampleTitle(condition.value.trim()) });
  }
  return events;
};

export interface PreviewCopy {
  description?: string;
  isPrivate?: boolean;
  location?: string;
  time: string;
  title: string;
}

export interface SyncPreview {
  copy: PreviewCopy | null;
  decidedBy: string;
  dropped: string[];
  followsShareAs: boolean;
}

const describeDecider = (rule: CompiledSyncRule | null, shareAs: ShareAs, title: string): string => {
  if (!rule || rule.id === "share") return `Share As · ${shareAsLabel(shareAs)}`;
  if (rule.id === SKIP_KEYWORDS_RULE_ID) {
    const keyword = rule.conditions.find((condition) =>
      condition.kind === "title_contains" && title.toLocaleLowerCase().includes(condition.value.toLocaleLowerCase()));
    if (keyword?.kind === "title_contains") return `Never Copy · Titles with “${keyword.value}”`;
  }
  if (rule.id.startsWith("skip:")) return `Never Copy · ${rule.name}`;
  return `Rule · ${rule.name}`;
};

// Runs the same compiled rules the sync engine uses, so the preview can't drift from what gets copied.
export const previewSync = (settings: SyncSettings, event: PreviewEvent, calendar: string): SyncPreview => {
  const rules = compileSyncRules(settings);
  const facts = {
    calendarName: calendar,
    description: event.description,
    isAllDay: Boolean(event.isAllDay),
    isFocusTime: Boolean(event.isFocusTime),
    isOutOfOffice: Boolean(event.isOutOfOffice),
    location: event.location,
    title: event.title,
  };
  const decider = findMatchingRule(rules, facts);
  const decidedBy = describeDecider(decider, settings.shareAs, event.title);
  const followsShareAs = !decider || decider.id === "share";
  const evaluation = evaluateRules(rules, facts);
  if (evaluation.skip) return { copy: null, decidedBy, dropped: [], followsShareAs };
  const dropped = [
    event.location !== evaluation.location && event.location,
    event.description !== evaluation.description && event.description,
  ].filter((detail): detail is string => Boolean(detail));
  return {
    copy: {
      description: evaluation.description,
      isPrivate: evaluation.isPrivate,
      location: evaluation.location,
      time: event.time,
      title: evaluation.summary,
    },
    decidedBy,
    dropped,
    followsShareAs,
  };
};

const ROLE_WORDS: Record<SyncCalendarRole, string> = {
  destination: "a destination",
  member: "a calendar in this sync",
  source: "a source",
};

export const describeChange = (change: SyncChange, calendarsById: CalendarsById): string => {
  switch (change.kind) {
    case "created": return "Sync created.";
    case "renamed": return `Renamed from “${change.from}”.`;
    case "mode_changed": return change.to === "both_ways" ? "Switched to Both Ways." : "Switched to One Way.";
    case "share_as_changed": return `Share As changed from ${shareAsLabel(change.from)} to ${shareAsLabel(change.to)}.`;
    case "busy_title_changed": return "Busy title changed.";
    case "private_changed": return change.to ? "Copies are now private." : "Copies are no longer private.";
    case "skip_changed": return `${change.to ? "Skipping" : "No longer skipping"} ${SKIP_LABELS[change.skip].toLowerCase()}.`;
    case "keyword_added": return `Skipping events titled “${change.keyword}”.`;
    case "keyword_removed": return `No longer skipping events titled “${change.keyword}”.`;
    case "calendar_added": return `Added ${calendarName(calendarsById, change.calendarId)} as ${ROLE_WORDS[change.role]}.`;
    case "calendar_removed": return `Removed ${calendarName(calendarsById, change.calendarId)} as ${ROLE_WORDS[change.role]}.`;
    case "rules_changed": return "Advanced rules changed.";
    case "paused": return "Paused. Copies stay as they are.";
    case "resumed": return "Resumed.";
  }
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

export const describeRun = (run: SyncRunRecord, calendarsById: CalendarsById): string => {
  const destination = calendarName(calendarsById, run.destinationCalendarId);
  const changes = [
    run.added > 0 && `${run.added} new`,
    run.removed > 0 && `${run.removed} removed`,
    run.failed > 0 && `${plural(run.failed, "change")} failed`,
  ].filter(Boolean);
  const shared = run.sharedDestination ? " (shared with other syncs)" : "";
  const skipped = run.skippedBy[0] ? ` Skipping ${plural(run.skipped, "event")}, most by ${run.skippedBy[0].name.toLowerCase()}.` : "";
  return `Synced to ${destination}${shared}. ${changes.join(", ") || "No changes"}.${skipped}`;
};

export const syncSettingsOf = (sync: SyncDefinition): SyncSettings => ({
  busyTitle: sync.busyTitle,
  markPrivate: sync.markPrivate,
  rules: sync.rules,
  shareAs: sync.shareAs,
  skipAllDay: sync.skipAllDay,
  skipFocusTime: sync.skipFocusTime,
  skipOutOfOffice: sync.skipOutOfOffice,
  skipTitleKeywords: sync.skipTitleKeywords,
});
