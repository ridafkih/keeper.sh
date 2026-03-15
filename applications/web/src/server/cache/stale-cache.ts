interface CacheEntry<TValue> {
  fetchedAtMs: number;
  value: TValue;
}

interface CreateStaleCacheOptions<TValue> {
  name: string;
  now?: () => number;
  ttlMs: number;
  load: () => Promise<TValue>;
  revalidationPolicy?: CacheRevalidationPolicy;
}

interface CacheSnapshot<TValue> {
  fetchedAtMs: number;
  value: TValue;
}

type CacheRevalidationPolicy = "always" | "when-stale";

interface CacheState<TValue> {
  entry: CacheEntry<TValue> | null;
  refreshTask: Promise<void> | null;
}

function createInitialState<TValue>(): CacheState<TValue> {
  return {
    entry: null,
    refreshTask: null,
  };
}

function isStale<TValue>(state: CacheState<TValue>, nowMs: number, ttlMs: number): boolean {
  if (state.entry === null) {
    return true;
  }

  return nowMs - state.entry.fetchedAtMs >= ttlMs;
}

function createRefreshTask<TValue>(
  state: CacheState<TValue>,
  refresh: () => Promise<void>,
  swallowErrors: boolean,
): Promise<void> {
  const refreshTask = swallowErrors ? refresh().catch(() => undefined) : refresh();
  state.refreshTask = refreshTask.finally(() => {
    state.refreshTask = null;
  });
  return state.refreshTask;
}

function shouldRevalidateInBackground<TValue>(
  policy: CacheRevalidationPolicy,
  state: CacheState<TValue>,
  nowMs: number,
  ttlMs: number,
): boolean {
  if (state.entry === null) {
    return false;
  }

  if (policy === "always") {
    return true;
  }

  return isStale(state, nowMs, ttlMs);
}

export function createStaleCache<TValue>(options: CreateStaleCacheOptions<TValue>) {
  const now = options.now ?? Date.now;
  const revalidationPolicy = options.revalidationPolicy ?? "when-stale";
  const state = createInitialState<TValue>();

  const refresh = async (): Promise<void> => {
    const loadedValue = await options.load();
    state.entry = {
      fetchedAtMs: now(),
      value: loadedValue,
    };
  };

  const refreshForeground = (): Promise<void> => {
    if (state.refreshTask !== null) {
      return state.refreshTask;
    }

    return createRefreshTask(state, refresh, false);
  };

  const refreshBackground = (): void => {
    if (state.refreshTask !== null) {
      return;
    }

    void createRefreshTask(state, refresh, true);
  };

  const getSnapshot = async (): Promise<CacheSnapshot<TValue>> => {
    if (state.entry === null) {
      await refreshForeground();
    } else if (
      shouldRevalidateInBackground(
        revalidationPolicy,
        state,
        now(),
        options.ttlMs,
      )
    ) {
      refreshBackground();
    }

    if (state.entry === null) {
      throw new Error(`${options.name} cache was not initialized.`);
    }

    return {
      fetchedAtMs: state.entry.fetchedAtMs,
      value: state.entry.value,
    };
  };

  return {
    getSnapshot,
  };
}
