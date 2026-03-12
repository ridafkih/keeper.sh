import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import type { RedisClient } from "bun";

const SYNC_KEY_PREFIX = "sync:generation:";

const getSyncKey = (userId: string): string => `${SYNC_KEY_PREFIX}${userId}`;

interface DestinationSyncResult {
  userId: string;
  calendarId: string;
  localEventCount: number;
  remoteEventCount: number;
  broadcast?: boolean;
}

type SyncStage = "fetching" | "comparing" | "processing" | "error";

interface SyncProgressUpdate {
  userId: string;
  calendarId: string;
  status: "syncing" | "error";
  stage: SyncStage;
  localEventCount: number;
  remoteEventCount: number;
  progress?: { current: number; total: number };
  lastOperation?: { type: "add" | "remove"; eventTime: string };
  inSync: false;
  error?: string;
}

interface SyncContext {
  userId: string;
  generation: number;
  isCurrent: () => Promise<boolean>;
  onDestinationSync?: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress?: (update: SyncProgressUpdate) => void;
}

interface SyncCoordinatorConfig {
  redis: RedisClient;
  onDestinationSync?: (result: DestinationSyncResult) => Promise<void>;
  onSyncProgress?: (update: SyncProgressUpdate) => void;
}

interface SyncCoordinator {
  startSync: (userId: string) => Promise<SyncContext>;
  isSyncCurrent: (context: SyncContext) => Promise<boolean>;
}

const isSyncCurrent = (context: SyncContext): Promise<boolean> => context.isCurrent();

const createSyncCoordinator = (config: SyncCoordinatorConfig): SyncCoordinator => {
  const { redis, onDestinationSync, onSyncProgress } = config;

  const startSync = async (userId: string): Promise<SyncContext> => {
    const key = getSyncKey(userId);
    const generation = await redis.incr(key);
    await redis.expire(key, SYNC_TTL_SECONDS);

    const isCurrent = async (): Promise<boolean> => {
      const currentGeneration = await redis.get(key);
      if (currentGeneration === null) {
        return false;
      }
      return Number.parseInt(currentGeneration, 10) === generation;
    };

    return { generation, isCurrent, onDestinationSync, onSyncProgress, userId };
  };

  return { isSyncCurrent, startSync };
};

export { createSyncCoordinator };
export type {
  DestinationSyncResult,
  SyncStage,
  SyncProgressUpdate,
  SyncContext,
  SyncCoordinatorConfig,
  SyncCoordinator,
};
