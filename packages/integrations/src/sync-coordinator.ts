import { log } from "@keeper.sh/log";
import type { RedisClient } from "bun";

const SYNC_KEY_PREFIX = "sync:generation:";
const SYNC_LOCK_PREFIX = "sync:lock:";
const SYNC_TTL_SECONDS = 86400;
const SYNC_LOCK_TTL_SECONDS = 60;

const getSyncKey = (userId: string): string => `${SYNC_KEY_PREFIX}${userId}`;
const getSyncLockKey = (userId: string): string => `${SYNC_LOCK_PREFIX}${userId}`;

export interface DestinationSyncResult {
  userId: string;
  destinationId: string;
  localEventCount: number;
  remoteEventCount: number;
  broadcast?: boolean;
}

export type SyncStage = "fetching" | "comparing" | "processing";

export interface SyncProgressUpdate {
  userId: string;
  destinationId: string;
  status: "syncing";
  stage: SyncStage;
  localEventCount: number;
  remoteEventCount: number;
  progress?: { current: number; total: number };
  lastOperation?: { type: "add" | "remove"; eventTime: string };
  inSync: false;
}

export interface SyncContext {
  userId: string;
  generation: number;
  acquired: boolean;
  refreshLock: () => Promise<void>;
  onDestinationSync?: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress?: (update: SyncProgressUpdate) => void;
}

export interface SyncCoordinatorConfig {
  redis: RedisClient;
  onDestinationSync?: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress?: (update: SyncProgressUpdate) => void;
}

export interface SyncCoordinator {
  startSync: (userId: string) => Promise<SyncContext>;
  isSyncCurrent: (context: SyncContext) => Promise<boolean>;
  endSync: (context: SyncContext) => Promise<void>;
}

export const createSyncCoordinator = (config: SyncCoordinatorConfig): SyncCoordinator => {
  const { redis, onDestinationSync, onSyncProgress } = config;

  const startSync = async (userId: string): Promise<SyncContext> => {
    const lockKey = getSyncLockKey(userId);
    const genKey = getSyncKey(userId);

    const acquired = await redis.setnx(lockKey, "1");

    const refreshLock = async () => {
      if (acquired) {
        await redis.expire(lockKey, SYNC_LOCK_TTL_SECONDS);
      }
    };

    if (!acquired) {
      log.debug({ userId }, "sync already in progress, skipping");
      return { userId, generation: 0, acquired: false, refreshLock, onDestinationSync, onSyncProgress };
    }

    await redis.expire(lockKey, SYNC_LOCK_TTL_SECONDS);

    const generation = await redis.incr(genKey);
    await redis.expire(genKey, SYNC_TTL_SECONDS);

    log.debug({ userId, generation }, "starting sync generation");

    return { userId, generation, acquired: true, refreshLock, onDestinationSync, onSyncProgress };
  };

  const isSyncCurrent = async (context: SyncContext): Promise<boolean> => {
    if (!context.acquired) return false;

    const key = getSyncKey(context.userId);
    const currentGeneration = await redis.get(key);

    if (currentGeneration === null) {
      return false;
    }

    return parseInt(currentGeneration, 10) === context.generation;
  };

  const endSync = async (context: SyncContext): Promise<void> => {
    if (!context.acquired) return;

    const lockKey = getSyncLockKey(context.userId);
    await redis.del(lockKey);

    log.debug({ userId: context.userId, generation: context.generation }, "ending sync generation");
  };

  return { startSync, isSyncCurrent, endSync };
};
