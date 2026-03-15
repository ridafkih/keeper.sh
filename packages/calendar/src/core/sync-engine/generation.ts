interface GenerationStore {
  incr: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  expire?: (key: string, seconds: number) => Promise<number>;
}

const GENERATION_PREFIX = "sync:gen:";
const GENERATION_TTL_SECONDS = 86_400;

const createRedisGenerationCheck = async (
  store: GenerationStore,
  calendarId: string,
): Promise<() => Promise<boolean>> => {
  const key = `${GENERATION_PREFIX}${calendarId}`;
  const generation = await store.incr(key);

  if (store.expire) {
    await store.expire(key, GENERATION_TTL_SECONDS);
  }

  return async () => {
    const current = await store.get(key);
    if (current === null) {
      return false;
    }
    return Number(current) === generation;
  };
};

export { createRedisGenerationCheck, GENERATION_TTL_SECONDS };
export type { GenerationStore };
