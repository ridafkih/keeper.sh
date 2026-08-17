interface Semaphore {
  readonly withPermit: <Value>(signal: AbortSignal, body: () => Promise<Value>) => Promise<Value>;
  readonly available: () => number;
  readonly waiting: () => number;
}

class PermitAborted extends Error {
  constructor() {
    super("the caller was aborted while it waited for a permit");
    this.name = "PermitAborted";
  }
}

interface Waiter {
  readonly resume: () => void;
  readonly refuse: () => void;
}

const createSemaphore = (permits: number): Semaphore => {
  const queue: Waiter[] = [];
  const permitsHeld = { held: 0 };

  const forget = (waiter: Waiter): void => {
    const position = queue.indexOf(waiter);
    if (position === -1) {
      return;
    }
    queue.splice(position, 1);
  };

  const release = (): void => {
    const next = queue.shift();
    if (!next) {
      permitsHeld.held -= 1;
      return;
    }
    next.resume();
  };

  const runHolding = async <Value>(
    signal: AbortSignal,
    body: () => Promise<Value>,
  ): Promise<Value> => {
    const guard = { released: false };
    const releaseOnce = (): void => {
      if (guard.released) {
        return;
      }
      guard.released = true;
      release();
    };
    const holding = new AbortController();
    signal.addEventListener("abort", releaseOnce, { once: true, signal: holding.signal });
    try {
      return await body();
    } finally {
      holding.abort();
      releaseOnce();
    }
  };

  const queued = <Value>(signal: AbortSignal, body: () => Promise<Value>): Promise<Value> => {
    const turn = Promise.withResolvers<null>();
    const listening = new AbortController();
    const waiter: Waiter = {
      resume: () => {
        listening.abort();
        turn.resolve(null);
      },
      refuse: () => {
        listening.abort();
        turn.reject(new PermitAborted());
      },
    };
    queue.push(waiter);
    signal.addEventListener(
      "abort",
      () => {
        forget(waiter);
        waiter.refuse();
      },
      { once: true, signal: listening.signal },
    );
    return turn.promise.then(() => runHolding(signal, body));
  };

  return {
    withPermit: <Value>(signal: AbortSignal, body: () => Promise<Value>): Promise<Value> => {
      if (signal.aborted) {
        return Promise.reject(new PermitAborted());
      }
      if (permitsHeld.held < permits) {
        permitsHeld.held += 1;
        return runHolding(signal, body);
      }
      return queued(signal, body);
    },
    available: () => permits - permitsHeld.held,
    waiting: () => queue.length,
  };
};

export { createSemaphore, PermitAborted };
export type { Semaphore };
