import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import type Redis from "ioredis";
import type { DestinationSyncResult, SyncProgressUpdate } from "./types";
import { SyncAggregateTracker } from "./aggregate-tracker";
import type { SyncAggregateMessage, SyncAggregateSnapshot } from "./aggregate-tracker";
import { widelog } from "widelogger";

const SYNC_AGGREGATE_LATEST_KEY_PREFIX = "sync:aggregate:latest:";
const SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX = "sync:aggregate:seq:";

interface SyncAggregateRuntimeConfig {
  redis: Redis;
  broadcast: (userId: string, eventName: string, data: unknown) => void;
  persistSyncStatus: (result: DestinationSyncResult, syncedAt: Date) => Promise<void>;
  tracker?: SyncAggregateTracker;
}

interface SyncAggregateRuntime {
  emitSyncAggregate: (userId: string, aggregate: SyncAggregateMessage) => Promise<void>;
  onDestinationSync: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress: (update: SyncProgressUpdate) => void;
  getCurrentSyncAggregate: (
    userId: string,
    fallback?: Omit<SyncAggregateSnapshot, "syncing">,
  ) => SyncAggregateMessage;
  getCachedSyncAggregate: (userId: string) => Promise<SyncAggregateMessage | null>;
}

const getSyncAggregateLatestKey = (userId: string): string =>
  `${SYNC_AGGREGATE_LATEST_KEY_PREFIX}${userId}`;

const getSyncAggregateSequenceKey = (userId: string): string =>
  `${SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX}${userId}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNumberField = (value: unknown): value is number => typeof value === "number";

const isSyncAggregateMessage = (value: unknown): value is SyncAggregateMessage => {
  if (!isRecord(value)) {
    return false;
  }

  if ("lastSyncedAt" in value) {
    const { lastSyncedAt } = value;
    if (lastSyncedAt !== null && typeof lastSyncedAt !== "string") {
      return false;
    }
  }

  return (
    isNumberField(value.progressPercent) &&
    isNumberField(value.seq) &&
    isNumberField(value.syncEventsProcessed) &&
    isNumberField(value.syncEventsRemaining) &&
    isNumberField(value.syncEventsTotal) &&
    typeof value.syncing === "boolean"
  );
};

const createSyncAggregateRuntime = (config: SyncAggregateRuntimeConfig): SyncAggregateRuntime => {
  const tracker = config.tracker ?? new SyncAggregateTracker();

  const emitSyncAggregate = async (
    userId: string,
    aggregate: SyncAggregateMessage,
  ): Promise<void> => {
    widelog.set("operation.name", "sync:aggregate:emit");
    widelog.set("operation.type", "sync-aggregate");
    widelog.set("user.id", userId);

    try {
      const sequenceKey = getSyncAggregateSequenceKey(userId);
      const sequence = await config.redis.incr(sequenceKey);
      await config.redis.expire(sequenceKey, SYNC_TTL_SECONDS);

      const payload: SyncAggregateMessage = { ...aggregate, seq: sequence };

      const latestKey = getSyncAggregateLatestKey(userId);
      await config.redis.set(latestKey, JSON.stringify(payload));
      await config.redis.expire(latestKey, SYNC_TTL_SECONDS);

      config.broadcast(userId, "sync:aggregate", payload);
    } catch (error) {
      widelog.errorFields(error);
      config.broadcast(userId, "sync:aggregate", aggregate);
    }
  };

  const onDestinationSync = async (result: DestinationSyncResult): Promise<void> => {
    if (result.broadcast === false) {
      return;
    }

    const syncedAt = new Date();
    await config.persistSyncStatus(result, syncedAt);

    const aggregate = tracker.trackDestinationSync(result, syncedAt.toISOString());
    if (aggregate) {
      await emitSyncAggregate(result.userId, aggregate);
    }
  };

  const onSyncProgress = (update: SyncProgressUpdate): void => {
    const aggregate = tracker.trackProgress(update);
    if (aggregate) {
      // Error handling is internal to emitSyncAggregate
      const _pending = emitSyncAggregate(update.userId, aggregate);
    }
  };

  const getCurrentSyncAggregate = (
    userId: string,
    fallback?: Omit<SyncAggregateSnapshot, "syncing">,
  ): SyncAggregateMessage => tracker.getCurrentAggregate(userId, fallback);

  const getCachedSyncAggregate = async (
    userId: string,
  ): Promise<SyncAggregateMessage | null> => {
    widelog.set("operation.name", "sync:aggregate:cached:parse");
    widelog.set("operation.type", "sync-aggregate");
    widelog.set("user.id", userId);

    try {
      const value = await config.redis.get(getSyncAggregateLatestKey(userId));
      if (!value) {
        return null;
      }

      const parsed: unknown = JSON.parse(value);
      if (isSyncAggregateMessage(parsed)) {
        return parsed;
      }
      return null;
    } catch (error) {
      widelog.errorFields(error);
      return null;
    }
  };

  return {
    emitSyncAggregate,
    onDestinationSync,
    onSyncProgress,
    getCurrentSyncAggregate,
    getCachedSyncAggregate,
  };
};

export { createSyncAggregateRuntime };
export type { SyncAggregateRuntimeConfig, SyncAggregateRuntime };
