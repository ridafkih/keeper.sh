class PermitAborted extends Error {
  constructor() {
    super("the caller was aborted while it waited for a collection permit");
    this.name = "PermitAborted";
  }
}

interface CollectionSemaphore {
  readonly withPermits: <Value>(
    keys: readonly string[],
    signal: AbortSignal,
    body: () => Promise<Value>,
  ) => Promise<Value>;
  readonly held: (key: string) => number;
  readonly available: (key: string) => number;
  readonly waiting: (key: string) => number;
  readonly peak: (key: string) => number;
  readonly waitingTotal: () => number;
}

interface Waiter {
  readonly admit: () => void;
  readonly refuse: () => void;
  readonly abandoned: () => boolean;
  settled: boolean;
}

interface KeyState {
  held: number;
  peak: number;
  readonly queue: Waiter[];
}

const orderedKeys = (keys: readonly string[]): readonly string[] =>
  [...new Set(keys)].toSorted();

const take = (state: KeyState): void => {
  state.held += 1;
  state.peak = Math.max(state.peak, state.held);
};

const purgeAbandoned = (state: KeyState): void => {
  const abandoned = state.queue.filter((waiter) => waiter.abandoned());
  if (abandoned.length === 0) {
    return;
  }
  const surviving = state.queue.filter((waiter) => !waiter.abandoned());
  state.queue.splice(0, state.queue.length, ...surviving);
  for (const waiter of abandoned) {
    waiter.refuse();
  }
};

const createCollectionSemaphore = (permitsPerCollection: number): CollectionSemaphore => {
  const states = new Map<string, KeyState>();

  const stateOf = (key: string): KeyState => {
    const existing = states.get(key);
    if (existing) {
      return existing;
    }
    const created: KeyState = { held: 0, peak: 0, queue: [] };
    states.set(key, created);
    return created;
  };

  const drive = (state: KeyState): void => {
    purgeAbandoned(state);
    while (state.held < permitsPerCollection && state.queue.length > 0) {
      const next = state.queue.shift();
      if (!next) {
        return;
      }
      take(state);
      next.admit();
    }
  };

  const release = (key: string): void => {
    const state = stateOf(key);
    state.held = Math.max(0, state.held - 1);
    drive(state);
  };

  const acquire = (key: string, signal: AbortSignal): Promise<null> => {
    const state = stateOf(key);
    if (signal.aborted) {
      return Promise.reject(new PermitAborted());
    }
    if (state.held < permitsPerCollection && state.queue.length === 0) {
      take(state);
      return Promise.resolve(null);
    }
    const pending = Promise.withResolvers<null>();
    const listening = new AbortController();
    const waiter: Waiter = {
      settled: false,
      admit: () => {
        waiter.settled = true;
        listening.abort();
        pending.resolve(null);
      },
      refuse: () => {
        waiter.settled = true;
        listening.abort();
        pending.reject(new PermitAborted());
      },
      abandoned: () => signal.aborted && !waiter.settled,
    };
    state.queue.push(waiter);
    signal.addEventListener(
      "abort",
      () => {
        drive(state);
      },
      { signal: listening.signal },
    );
    return pending.promise;
  };

  const acquireAll = async (keys: readonly string[], signal: AbortSignal): Promise<void> => {
    const taken: string[] = [];
    for (const key of keys) {
      const admitted = await acquire(key, signal).then(
        () => true,
        () => false,
      );
      if (!admitted) {
        for (const held of taken) {
          release(held);
        }
        throw new PermitAborted();
      }
      taken.push(key);
    }
  };

  const freeToEnter = (key: string): boolean => {
    const state = stateOf(key);
    return state.held < permitsPerCollection && state.queue.length === 0;
  };

  const releasingAfter = async <Value>(
    keys: readonly string[],
    body: () => Promise<Value>,
  ): Promise<Value> => {
    try {
      return await body();
    } finally {
      for (const key of keys) {
        release(key);
      }
    }
  };

  const queuedThenRun = async <Value>(
    wanted: readonly string[],
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    await acquireAll(wanted, signal);
    return releasingAfter(wanted, body);
  };

  const withPermits = <Value>(
    keys: readonly string[],
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    const wanted = orderedKeys(keys);
    if (signal.aborted) {
      return Promise.reject(new PermitAborted());
    }
    if (!wanted.every((key) => freeToEnter(key))) {
      return queuedThenRun(wanted, signal, body);
    }
    for (const key of wanted) {
      take(stateOf(key));
    }
    return releasingAfter(wanted, body);
  };

  return {
    withPermits,
    held: (key: string) => stateOf(key).held,
    available: (key: string) => Math.max(0, permitsPerCollection - stateOf(key).held),
    waiting: (key: string) => stateOf(key).queue.length,
    peak: (key: string) => stateOf(key).peak,
    waitingTotal: () => [...states.values()].reduce((total, state) => total + state.queue.length, 0),
  };
};

export { createCollectionSemaphore, PermitAborted };
export type { CollectionSemaphore };
