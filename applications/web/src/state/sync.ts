import { atom } from "jotai";
import type { SyncAggregate } from "@keeper.sh/data-schemas/client";

export type CompositeState = "idle" | "syncing";

export type SyncAggregateData = SyncAggregate;

export interface CompositeSyncState {
  state: CompositeState;
  seq: number;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  lastSyncedAt: string | null;
  connected: boolean;
  hasReceivedAggregate: boolean;
  pending: boolean;
}

export const syncStateAtom = atom<CompositeSyncState>({
  state: "idle",
  seq: 0,
  progressPercent: 100,
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  lastSyncedAt: null,
  connected: false,
  hasReceivedAggregate: false,
  pending: false,
});

export const syncPendingAtom = atom(false);

export const syncStatusLabelAtom = atom((get) => {
  const composite = get(syncStateAtom);
  const localPending = get(syncPendingAtom);

  if (!composite.connected) {
    return "Connecting";
  }

  if (!composite.hasReceivedAggregate) {
    return "Connecting";
  }

  if (composite.state === "syncing") {
    return "Syncing";
  }

  if (localPending || composite.pending) {
    return "Pending";
  }

  if (composite.syncEventsRemaining === 0) {
    return "Up to Date";
  }

  return "Sync Paused";
});

export const syncStatusShimmerAtom = atom((get) => {
  const composite = get(syncStateAtom);
  const localPending = get(syncPendingAtom);

  return (
    !composite.connected ||
    !composite.hasReceivedAggregate ||
    composite.state === "syncing" ||
    localPending ||
    composite.pending
  );
});
