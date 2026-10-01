import type { SyncDetail } from "@keeper.sh/data-schemas";
import type { CompositeSyncState } from "@/state/sync";

export type FirstRunProgress =
  | { kind: "counting"; percent: number }
  | { kind: "copying"; percent: number; processed: number; total: number }
  | { kind: "finished"; copied: number };

// Every destination reports its first run once it has written its copies, which is the only reliable end.
export const isFirstRunFinished = (sync: SyncDetail | undefined): boolean =>
  Boolean(sync && sync.destinations.length > 0 && sync.destinations.every((destination) => destination.lastSyncedAt));

/*
 * The live count is the account's WebSocket progress, which during onboarding is this one sync.
 * Each calendar only reports its total after fetching, so the total grows for a moment before it settles.
 */
export const resolveFirstRunProgress = (sync: SyncDetail | undefined, aggregate: CompositeSyncState): FirstRunProgress => {
  if (sync && isFirstRunFinished(sync)) return { copied: sync.copiedCount, kind: "finished" };
  if (aggregate.state !== "syncing") return { kind: "counting", percent: 0 };
  if (aggregate.syncEventsTotal === 0) return { kind: "counting", percent: aggregate.progressPercent };
  return {
    kind: "copying",
    percent: aggregate.progressPercent,
    processed: aggregate.syncEventsProcessed,
    total: aggregate.syncEventsTotal,
  };
};
