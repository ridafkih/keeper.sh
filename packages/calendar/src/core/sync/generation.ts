import type { Redis } from "ioredis";

interface SyncGeneration {
  value: number;
  isCurrent: () => Promise<boolean>;
}

interface SyncGenerationStore {
  next: (calendarId: string) => Promise<SyncGeneration>;
}

const GENERATION_KEY_PREFIX = "sync:gen:";

const createSyncGenerationStore = (redis: Redis): SyncGenerationStore => {
  const next = async (calendarId: string): Promise<SyncGeneration> => {
    const key = `${GENERATION_KEY_PREFIX}${calendarId}`;
    const value = await redis.incr(key);

    const isCurrent = async (): Promise<boolean> => {
      const current = await redis.get(key);
      if (current === null) {
        return false;
      }
      return Number(current) === value;
    };

    return { value, isCurrent };
  };

  return { next };
};

export { createSyncGenerationStore };
export type { SyncGeneration, SyncGenerationStore };
