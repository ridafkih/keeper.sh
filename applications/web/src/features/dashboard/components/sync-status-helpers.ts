import type { CompositeSyncState } from "../../../state/sync";

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
};

const resolveSyncPercent = (composite: CompositeSyncState): number | null => {
  if (!composite.hasReceivedAggregate) {
    return null;
  }

  if (composite.syncEventsTotal > 0) {
    return clampPercent((composite.syncEventsProcessed / composite.syncEventsTotal) * 100);
  }

  if (composite.state === "syncing") {
    return clampPercent(composite.progressPercent);
  }

  if (composite.connected && composite.syncEventsRemaining === 0) {
    return 100;
  }

  return null;
};

export { clampPercent, resolveSyncPercent };
