import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import type Redis from "ioredis";
import type { DestinationSyncResult, SyncProgressUpdate } from "./types";
import { SyncAggregateTracker } from "./aggregate-tracker";
import type { SyncAggregateMessage, SyncAggregateSnapshot } from "./aggregate-tracker";

const SYNC_AGGREGATE_LATEST_KEY_PREFIX = "sync:aggregate:latest:";
const SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX = "sync:aggregate:seq:";

const MILLISECONDS_PER_MINUTE = 60_000;
const STALE_SYNCING_THRESHOLD_MINUTES = 10;
const STALE_SYNCING_THRESHOLD_MS = STALE_SYNCING_THRESHOLD_MINUTES * MILLISECONDS_PER_MINUTE;

const SET_LATEST_IF_NEWER_LUA = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, decoded = pcall(cjson.decode, current)
  if ok and type(decoded) == 'table' then
    local currentSeq = tonumber(decoded.seq)
    if currentSeq and currentSeq >= tonumber(ARGV[2]) then
      return 0
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

type SyncAggregateErrorScope = "emit" | "emit-queue" | "cache-read";

interface SyncAggregateRuntimeConfig {
  redis: Redis;
  broadcast: (userId: string, eventName: string, data: unknown) => void;
  persistSyncStatus: (result: DestinationSyncResult, syncedAt: Date) => Promise<void>;
  onError: (scope: SyncAggregateErrorScope, error: Error) => void;
  tracker?: SyncAggregateTracker;
}

interface SyncAggregateRuntime {
  emitSyncAggregate: (userId: string, aggregate: SyncAggregateMessage) => Promise<void>;
  onDestinationSync: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress: (update: SyncProgressUpdate) => void;
  beginSyncRun: (userId: string) => void;
  releaseSyncing: (userId: string) => Promise<void>;
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

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(String(value));
};

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

  if ("emittedAt" in value && typeof value.emittedAt !== "string") {
    return false;
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

const isStaleSyncingAggregate = (aggregate: SyncAggregateMessage): boolean => {
  if (!aggregate.syncing) {
    return false;
  }

  if (typeof aggregate.emittedAt !== "string") {
    return true;
  }

  const emittedAtMs = Date.parse(aggregate.emittedAt);
  if (!Number.isFinite(emittedAtMs)) {
    return true;
  }

  return Date.now() - emittedAtMs > STALE_SYNCING_THRESHOLD_MS;
};

const createSyncAggregateRuntime = (config: SyncAggregateRuntimeConfig): SyncAggregateRuntime => {
  const tracker = config.tracker ?? new SyncAggregateTracker();
  const emitQueueByUser = new Map<string, Promise<void>>();

  const performEmit = async (
    userId: string,
    aggregate: SyncAggregateMessage,
  ): Promise<void> => {
    try {
      const sequenceKey = getSyncAggregateSequenceKey(userId);
      const sequence = await config.redis.incr(sequenceKey);
      await config.redis.expire(sequenceKey, SYNC_TTL_SECONDS);

      const payload: SyncAggregateMessage = {
        ...aggregate,
        emittedAt: new Date().toISOString(),
        seq: sequence,
      };

      await config.redis.eval(
        SET_LATEST_IF_NEWER_LUA,
        1,
        getSyncAggregateLatestKey(userId),
        JSON.stringify(payload),
        String(sequence),
        String(SYNC_TTL_SECONDS),
      );

      config.broadcast(userId, "sync:aggregate", payload);
    } catch (error) {
      config.onError("emit", toError(error));
      config.broadcast(userId, "sync:aggregate", aggregate);
    }
  };

  const emitSyncAggregate = (
    userId: string,
    aggregate: SyncAggregateMessage,
  ): Promise<void> => {
    const previous = emitQueueByUser.get(userId) ?? Promise.resolve();
    const next = previous.then(() => performEmit(userId, aggregate));
    const settled = next.catch((error: unknown) => {
      config.onError("emit-queue", toError(error));
    });
    emitQueueByUser.set(userId, settled);

    return next;
  };

  const onDestinationSync = async (result: DestinationSyncResult): Promise<void> => {
    if (result.broadcast === false) {
      return;
    }

    const syncedAt = new Date();

    try {
      await config.persistSyncStatus(result, syncedAt);
    } finally {
      const aggregate = tracker.trackDestinationSync(result, syncedAt.toISOString());
      if (aggregate) {
        await emitSyncAggregate(result.userId, aggregate);
      }
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
    try {
      const value = await config.redis.get(getSyncAggregateLatestKey(userId));
      if (!value) {
        return null;
      }

      const parsed: unknown = JSON.parse(value);
      if (!isSyncAggregateMessage(parsed)) {
        return null;
      }

      if (isStaleSyncingAggregate(parsed)) {
        return null;
      }

      return parsed;
    } catch (error) {
      config.onError("cache-read", toError(error));
      return null;
    }
  };

  const beginSyncRun = (userId: string): void => {
    tracker.resetUser(userId);
    tracker.holdSyncing(userId);
  };

  const releaseSyncing = async (userId: string): Promise<void> => {
    tracker.releaseSyncing(userId);

    const aggregate = tracker.getCurrentAggregate(userId);
    await emitSyncAggregate(userId, aggregate);
  };

  return {
    emitSyncAggregate,
    onDestinationSync,
    onSyncProgress,
    beginSyncRun,
    releaseSyncing,
    getCurrentSyncAggregate,
    getCachedSyncAggregate,
  };
};

export { createSyncAggregateRuntime };
export type { SyncAggregateRuntimeConfig, SyncAggregateRuntime };
