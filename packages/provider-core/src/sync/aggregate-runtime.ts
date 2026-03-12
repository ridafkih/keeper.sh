import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import type { RedisClient } from "bun";
import type { DestinationSyncResult, SyncProgressUpdate } from "./coordinator";
import { SyncAggregateTracker } from "./aggregate-tracker";
import type { SyncAggregateMessage, SyncAggregateSnapshot } from "./aggregate-tracker";
import { widelogger } from "widelogger";

const { widelog } = widelogger({
  service: "keeper",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

const SYNC_AGGREGATE_LATEST_KEY_PREFIX = "sync:aggregate:latest:";
const SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX = "sync:aggregate:seq:";

interface SyncAggregateRuntimeConfig {
  redis: RedisClient;
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
    try {
      const sequenceKey = getSyncAggregateSequenceKey(userId);
      const sequence = await config.redis.incr(sequenceKey);
      await config.redis.expire(sequenceKey, SYNC_TTL_SECONDS);

      const payload: SyncAggregateMessage = { ...aggregate, seq: sequence };

      if (!payload.syncing) {
        const latestKey = getSyncAggregateLatestKey(userId);
        await config.redis.set(latestKey, JSON.stringify(payload));
        await config.redis.expire(latestKey, SYNC_TTL_SECONDS);
      }

      config.broadcast(userId, "sync:aggregate", payload);
    } catch (error) {
      widelog.context(() => {
        widelog.set("operation.name", "sync:aggregate:emit");
        widelog.set("operation.type", "sync-aggregate");
        widelog.set("user.id", userId);
        widelog.errorFields(error);
        widelog.flush();
      });
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
      emitSyncAggregate(update.userId, aggregate).catch((error) => {
        widelog.context(() => {
          widelog.set("operation.name", "sync:aggregate:progress");
          widelog.set("operation.type", "sync-aggregate");
          widelog.set("user.id", update.userId);
          widelog.errorFields(error);
          widelog.flush();
        });
      });
    }
  };

  const getCurrentSyncAggregate = (
    userId: string,
    fallback?: Omit<SyncAggregateSnapshot, "syncing">,
  ): SyncAggregateMessage => tracker.getCurrentAggregate(userId, fallback);

  const getCachedSyncAggregate = async (
    userId: string,
  ): Promise<SyncAggregateMessage | null> => {
    const value = await config.redis.get(getSyncAggregateLatestKey(userId));
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (isSyncAggregateMessage(parsed)) {
        return parsed;
      }
      return null;
    } catch (error) {
      widelog.context(() => {
        widelog.set("operation.name", "sync:aggregate:cached:parse");
        widelog.set("operation.type", "sync-aggregate");
        widelog.set("user.id", userId);
        widelog.errorFields(error);
        widelog.flush();
      });
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
