interface GenerationStore {
  incr: (key: string) => Promise<number>;
  get: (key: string) => Promise<string | null>;
}

const GENERATION_PREFIX = "sync:gen:";

const createRedisGenerationCheck = async (
  store: GenerationStore,
  calendarId: string,
): Promise<() => Promise<boolean>> => {
  const key = `${GENERATION_PREFIX}${calendarId}`;
  const generation = await store.incr(key);

  return async () => {
    const current = await store.get(key);
    if (current === null) {
      return false;
    }
    return Number(current) === generation;
  };
};

export { createRedisGenerationCheck };
export type { GenerationStore };
