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

const resolveSyncAggregatePayload = async (
  userId: string,
  fallback: SyncAggregateFallbackPayload,
  dependencies: ResolveSyncAggregateDependencies,
): Promise<SyncAggregatePayload> => {
  const cached = await dependencies.getCachedSyncAggregate(userId);
  if (cached && dependencies.isValidSyncAggregate(cached)) {
    return {
      ...cached,
      ...(!("lastSyncedAt" in cached) && { lastSyncedAt: fallback.lastSyncedAt }),
    };
  }

  return dependencies.getCurrentSyncAggregate(userId, fallback);
};

export { resolveSyncAggregatePayload };
export type { SyncAggregatePayload, SyncAggregateFallbackPayload, ResolveSyncAggregateDependencies };
