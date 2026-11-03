import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { MappingSyncState, SyncAggregate } from "@keeper.sh/data-schemas/client";

export type CompositeState = "idle" | "syncing";

export type SyncAggregateData = SyncAggregate;

export type MappingSyncStateData = MappingSyncState;

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
  mappings: MappingSyncStateData | null;
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
  mappings: null,
});

type SyncStatusLabel = "Connecting" | "Error" | "Syncing" | "Up to date" | "Paused";

const resolveSyncStatusLabel = (composite: CompositeSyncState): SyncStatusLabel => {
  if (!composite.connected || !composite.hasReceivedAggregate || !composite.mappings) {
    return "Connecting";
  }

  if (composite.mappings.failingCount > 0) {
    return "Error";
  }

  if (composite.state === "syncing" || composite.mappings.pendingCount > 0) {
    return "Syncing";
  }

  if (composite.syncEventsRemaining === 0) {
    return "Up to date";
  }

  return "Paused";
};

export const syncStatusLabelAtom = selectAtom(syncStateAtom, resolveSyncStatusLabel);

export const syncStatusShimmerAtom = selectAtom(syncStateAtom, (composite) => {
  const label = resolveSyncStatusLabel(composite);
  return label === "Connecting" || label === "Syncing";
});
