import { compileSyncRules, deriveSyncPairs, evaluateRules, findMatchingRule } from "@keeper.sh/data-schemas";
import type {
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
}

const describeDecider = (rule: { id: string; name: string } | null, shareAs: ShareAs): string => {
  if (!rule || rule.id === "share") return `Share As · ${shareAsLabel(shareAs)}`;
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
  const decidedBy = describeDecider(findMatchingRule(rules, facts), settings.shareAs);
  const evaluation = evaluateRules(rules, facts);
  if (evaluation.skip) return { copy: null, decidedBy };
  return {
    copy: {
      description: evaluation.description,
      isPrivate: evaluation.isPrivate,
      location: evaluation.location,
      time: event.time,
      title: evaluation.summary,
    },
    decidedBy,
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
