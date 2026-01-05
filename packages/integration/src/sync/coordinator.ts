import { getWideEvent } from "@keeper.sh/log";
import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import type { RedisClient } from "bun";

const SYNC_KEY_PREFIX = "sync:generation:";

const getSyncKey = (userId: string): string => `${SYNC_KEY_PREFIX}${userId}`;

const enrichWideEventWithSyncContext = (
  userId: string,
  generation: number
): void => {
  const event = getWideEvent();
  if (!event) return;
  event.set({ userId, syncGeneration: generation });
};

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
  isCurrent: () => Promise<boolean>;
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
}

export const createSyncCoordinator = (config: SyncCoordinatorConfig): SyncCoordinator => {
  const { redis, onDestinationSync, onSyncProgress } = config;

  const startSync = async (userId: string): Promise<SyncContext> => {
    const key = getSyncKey(userId);
    const generation = await redis.incr(key);
    await redis.expire(key, SYNC_TTL_SECONDS);

    enrichWideEventWithSyncContext(userId, generation);

    const isCurrent = async (): Promise<boolean> => {
      const currentGeneration = await redis.get(key);
      if (currentGeneration === null) return false;
      return parseInt(currentGeneration, 10) === generation;
    };

    return { userId, generation, isCurrent, onDestinationSync, onSyncProgress };
  };

  const isSyncCurrent = async (context: SyncContext): Promise<boolean> => {
    return context.isCurrent();
  };

  return { startSync, isSyncCurrent };
};
