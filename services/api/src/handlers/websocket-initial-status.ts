interface SocketSender {
  send: (message: string) => unknown;
}

interface InitialSyncAggregateFallbackPayload {
  lastSyncedAt: string | null;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
}

interface OutgoingSyncAggregatePayload {
  lastSyncedAt?: string | null;
  pending?: boolean;
  progressPercent: number;
  syncEventsProcessed: number;
  syncEventsRemaining: number;
  syncEventsTotal: number;
  syncing: boolean;
  seq: number;
}

interface SendInitialSyncStatusDependencies {
  selectLatestDestinationSyncedAt: (userId: string) => Promise<Date | null>;
  resolveSyncAggregatePayload: (
    userId: string,
    fallback: InitialSyncAggregateFallbackPayload,
  ) => Promise<unknown>;
  isValidSyncAggregate: (value: unknown) => value is OutgoingSyncAggregatePayload;
  isSyncPending?: (userId: string) => Promise<boolean>;
}

const INITIAL_COUNT = 0;
const COMPLETE_PERCENT = 100;

const applyPendingFlag = async (
  payload: OutgoingSyncAggregatePayload,
  userId: string,
  dependencies: SendInitialSyncStatusDependencies,
): Promise<OutgoingSyncAggregatePayload> => {
  const pending = await dependencies.isSyncPending?.(userId);
  if (!pending) {
    return payload;
  }
  return { ...payload, pending: true };
};

const createInitialFallbackPayload = (
  lastSyncedAt: string | null,
): InitialSyncAggregateFallbackPayload => ({
  lastSyncedAt,
  progressPercent: COMPLETE_PERCENT,
  syncEventsProcessed: INITIAL_COUNT,
  syncEventsRemaining: INITIAL_COUNT,
  syncEventsTotal: INITIAL_COUNT,
});

const runSendInitialSyncStatus = async (
  userId: string,
  socket: SocketSender,
  dependencies: SendInitialSyncStatusDependencies,
): Promise<void> => {
  const latestDestinationSyncedAtDate =
    await dependencies.selectLatestDestinationSyncedAt(userId);
  const latestDestinationSyncedAt = latestDestinationSyncedAtDate?.toISOString() ?? null;

  const resolvedPayload = await dependencies.resolveSyncAggregatePayload(
    userId,
    createInitialFallbackPayload(latestDestinationSyncedAt),
  );

  if (!dependencies.isValidSyncAggregate(resolvedPayload)) {
    throw new Error("Invalid initial sync aggregate payload");
  }

  const data = await applyPendingFlag(resolvedPayload, userId, dependencies);

  socket.send(
    JSON.stringify({
      data,
      event: "sync:aggregate",
    }),
  );
};

export {
  runSendInitialSyncStatus,
  createInitialFallbackPayload,
};
export type {
  InitialSyncAggregateFallbackPayload,
  OutgoingSyncAggregatePayload,
  SendInitialSyncStatusDependencies,
};
