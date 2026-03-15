interface SyncAggregatePayload {
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  lastSyncedAt?: string | null;
  syncing: boolean;
  seq?: number;
}

type SyncAggregateFallbackPayload = Omit<SyncAggregatePayload, "seq" | "syncing"> & {
  lastSyncedAt: string | null;
};

interface ResolveSyncAggregateDependencies {
  getCurrentSyncAggregate: (
    userId: string,
    fallback: SyncAggregateFallbackPayload,
  ) => SyncAggregatePayload;
  getCachedSyncAggregate: (userId: string) => Promise<unknown>;
  isValidSyncAggregate: (value: unknown) => value is SyncAggregatePayload;
}

const INITIAL_COUNT = 0;

const resolveSyncAggregatePayload = async (
  userId: string,
  fallback: SyncAggregateFallbackPayload,
  dependencies: ResolveSyncAggregateDependencies,
): Promise<SyncAggregatePayload> => {
  const current = dependencies.getCurrentSyncAggregate(userId, fallback);
  const hasLiveCurrent = current.syncing || current.syncEventsRemaining > INITIAL_COUNT;
  if (hasLiveCurrent) {
    return current;
  }

  const cached = await dependencies.getCachedSyncAggregate(userId);
  if (!cached || !dependencies.isValidSyncAggregate(cached)) {
    return current;
  }
  if (cached.syncing) {
    return current;
  }

  return {
    ...cached,
    ...(!("lastSyncedAt" in cached) && { lastSyncedAt: fallback.lastSyncedAt }),
  };
};

export { resolveSyncAggregatePayload };
export type { SyncAggregatePayload, SyncAggregateFallbackPayload, ResolveSyncAggregateDependencies };
