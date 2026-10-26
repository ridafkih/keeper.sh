import { withoutProSettings, type SyncCalendarRole, type SyncSummary } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import {
  addConnectedCalendar,
  buildFirstConnectDraft,
  createSyncDraft,
  fitsRole,
  pruneStaleIds,
  switchMode,
  type SyncDraft,
} from "@/features/syncs/sync-draft";
import { SYNC_TEMPLATES, type SyncTemplateKey } from "@/features/syncs/templates";

export interface SetupDraft {
  version: 5;
  sync: SyncDraft;
  // The role whose blank the user left to connect an account, restored when they come back.
  pending: SyncCalendarRole | null;
  firstConnect: boolean;
  // The account the user last came back from connecting, so it can be offered to the syncs they already have.
  connectedAccountId: string | null;
}

export const createEmptyDraft = (): SetupDraft => ({
  connectedAccountId: null,
  firstConnect: false,
  pending: null,
  sync: createSyncDraft(),
  version: 5,
});

const isUntouched = (draft: SetupDraft): boolean =>
  !draft.firstConnect
  && draft.sync.sourceCalendarIds.length === 0
  && draft.sync.destinationCalendarIds.length === 0
  && draft.sync.memberCalendarIds.length === 0;

// A new user with two usable calendars starts on Block My Time instead of an empty sentence.
export const seedFirstConnect = (
  draft: SetupDraft,
  sources: CalendarSource[],
  syncCount: number,
  canUseEventFilters = true,
): SetupDraft => {
  if (syncCount > 0 || !isUntouched(draft)) return draft;
  const sync = buildFirstConnectDraft(sources, canUseEventFilters);
  return sync ? { ...draft, firstConnect: true, sync } : draft;
};

export const withSync = (draft: SetupDraft, sync: SyncDraft): SetupDraft => ({ ...draft, sync });

export const markPending = (draft: SetupDraft, role: SyncCalendarRole): SetupDraft => ({ ...draft, pending: role });

export const reconcileSources = (draft: SetupDraft, sources: CalendarSource[]): SetupDraft => {
  const sync = pruneStaleIds(draft.sync, sources);
  if (sync === draft.sync && draft.pending === null) return draft;
  return { ...draft, pending: null, sync };
};

const holdsAccount = (sync: SyncDraft, sources: CalendarSource[], accountId: string): boolean => {
  const chosen = new Set([...sync.sourceCalendarIds, ...sync.destinationCalendarIds, ...sync.memberCalendarIds]);
  return sources.some((source) => source.accountId === accountId && chosen.has(source.id));
};

// Without a blank to fill, an account already in the draft (say, from the first-connect seed) adds nothing more.
export const resolveConnectedAccount = (draft: SetupDraft, sources: CalendarSource[], accountId: string): SetupDraft => {
  const pruned = pruneStaleIds(draft.sync, sources);
  const skip = draft.pending === null && holdsAccount(pruned, sources, accountId);
  return {
    ...draft,
    connectedAccountId: accountId,
    pending: null,
    sync: skip ? pruned : addConnectedCalendar(pruned, sources, accountId, draft.pending),
  };
};

const templateName = (template: SyncTemplateKey | null): string | null => (template ? SYNC_TEMPLATES[template].name : null);

// Switching profile keeps the calendars already picked, and a name the user typed.
export const applyTemplate = (
  draft: SetupDraft,
  template: SyncTemplateKey | null,
  calendarsById: ReadonlyMap<string, CalendarSource>,
  locked: boolean,
): SetupDraft => {
  const current = draft.sync;
  const templateMode = template ? SYNC_TEMPLATES[template].values.mode : null;
  const calendars = switchMode(current, templateMode ?? current.mode, calendarsById);
  const typedName = current.name !== "" && current.name !== templateName(current.template);
  const overrides = typedName ? { ...calendars, name: current.name } : calendars;
  const sync = createSyncDraft(template, overrides);
  return { ...draft, sync: locked ? withoutProSettings(sync) : sync };
};

export interface AddToSyncTarget {
  sync: SyncSummary;
  calendar: CalendarSource | null;
}

// For each existing sync, the calendar from the connected account that could join it, if any.
export const resolveAddToSyncTargets = (
  syncs: readonly SyncSummary[],
  sources: CalendarSource[],
  accountId: string | null,
): AddToSyncTarget[] =>
  syncs.map((sync) => {
    if (!accountId) return { calendar: null, sync };
    const role: SyncCalendarRole = sync.mode === "both_ways" ? "member" : "destination";
    const taken = new Set([...sync.sourceCalendarIds, ...sync.destinationCalendarIds, ...sync.memberCalendarIds]);
    const calendar = sources.find((source) =>
      source.accountId === accountId && !source.disabled && fitsRole(source, role) && !taken.has(source.id));
    return { calendar: calendar ?? null, sync };
  });
