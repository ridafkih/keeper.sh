import type { SyncCalendarRole } from "@keeper.sh/data-schemas";
import type { CalendarSource } from "@/types/api";
import {
  addConnectedCalendar,
  buildFirstConnectDraft,
  createSyncDraft,
  pruneStaleIds,
  type SyncDraft,
} from "@/features/syncs/sync-draft";

export interface SetupDraft {
  version: 4;
  sync: SyncDraft;
  // The role whose blank the user left to connect an account, restored when they come back.
  pending: SyncCalendarRole | null;
  firstConnect: boolean;
}

export const createEmptyDraft = (): SetupDraft => ({
  firstConnect: false,
  pending: null,
  sync: createSyncDraft(),
  version: 4,
});

const isUntouched = (draft: SetupDraft): boolean =>
  !draft.firstConnect
  && draft.sync.sourceCalendarIds.length === 0
  && draft.sync.destinationCalendarIds.length === 0
  && draft.sync.memberCalendarIds.length === 0;

// A new user with two usable calendars starts on Block My Time instead of an empty sentence.
export const seedFirstConnect = (draft: SetupDraft, sources: CalendarSource[], syncCount: number): SetupDraft => {
  if (syncCount > 0 || !isUntouched(draft)) return draft;
  const sync = buildFirstConnectDraft(sources);
  return sync ? { ...draft, firstConnect: true, sync } : draft;
};

export const withSync = (draft: SetupDraft, sync: SyncDraft): SetupDraft => ({ ...draft, sync });

export const markPending = (draft: SetupDraft, role: SyncCalendarRole): SetupDraft => ({ ...draft, pending: role });

export const reconcileSources = (draft: SetupDraft, sources: CalendarSource[]): SetupDraft => {
  const sync = pruneStaleIds(draft.sync, sources);
  if (sync === draft.sync && draft.pending === null) return draft;
  return { ...draft, pending: null, sync };
};

export const resolveConnectedAccount = (draft: SetupDraft, sources: CalendarSource[], accountId: string): SetupDraft => ({
  ...draft,
  pending: null,
  sync: addConnectedCalendar(pruneStaleIds(draft.sync, sources), sources, accountId, draft.pending),
});
