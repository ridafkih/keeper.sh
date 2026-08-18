const DEFAULT_CAPACITY = 50;

interface SerialFlushWorkerOptions {
  budget?: number;
  capacity?: number;
}

interface FlushReservation<TItem, TResult> {
  release(): void;
  submit(item: TItem): Promise<TResult>;
}

interface SerialFlushWorker<TItem, TResult> {
  close(): Promise<void>;
  reserve(weight: number, signal?: AbortSignal): Promise<FlushReservation<TItem, TResult>>;
  submit(item: TItem, signal?: AbortSignal): Promise<TResult>;
}

interface QueuedItem<TItem, TResult> {
  item: TItem;
  reject: (reason: unknown) => void;
  resolve: (value: TResult) => void;
}

interface SlotWaiter {
  grant: () => boolean;
  reject: (reason: unknown) => void;
}

interface WeightWaiter {
  aborted: () => boolean;
  grant: () => void;
  reject: (reason: unknown) => void;
  weight: number;
}

/*
 * Bounded serial worker: many callers may submit concurrently, but `run` is
 * invoked one item at a time in submission order. Once `capacity` items are
 * queued, further submits park until a slot frees, so queued memory stays
 * bounded no matter how fast producers go.
 *
 * When `budget` is set the worker also supports weighted reservations:
 * `reserve(weight)` acquires that many weight units BEFORE any payload
 * exists, parking FIFO when the budget is exhausted, so callers can gate
 * expensive fetches on available memory budget rather than item counts.
 */
const createSerialFlushWorker = <TItem, TResult>(
  run: (item: TItem) => Promise<TResult>,
  options?: SerialFlushWorkerOptions,
): SerialFlushWorker<TItem, TResult> => {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const budget = options?.budget;
  const queue: QueuedItem<TItem, TResult>[] = [];
  const slotWaiters: SlotWaiter[] = [];
  const weightWaiters: WeightWaiter[] = [];
  const idleWaiters: (() => void)[] = [];
  let outstandingWeight = 0;
  let closed = false;
  let pumping = false;

  const grantSlot = (): void => {
    // Skip waiters whose submits already aborted; the slot goes to the next live one.
    while (slotWaiters.length > 0) {
      const waiter = slotWaiters.shift();
      if (waiter && waiter.grant()) {
        return;
      }
    }
  };

  const grantWeight = (): void => {
    if (typeof budget !== "number") {
      return;
    }
    // FIFO: only the head may be admitted, and only while it fits the budget.
    while (weightWaiters.length > 0) {
      const [head] = weightWaiters;
      if (!head) {
        return;
      }
      if (head.aborted()) {
        // An aborted waiter already rejected; drop it so it cannot block the line.
        weightWaiters.shift();
        continue;
      }
      if (outstandingWeight + head.weight > budget) {
        return;
      }
      weightWaiters.shift();
      head.grant();
    }
  };

  const pump = async (): Promise<void> => {
    if (pumping) {
      return;
    }
    pumping = true;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) {
        break;
      }
      // Dequeuing frees a queue slot, so a parked submit may enqueue now.
      grantSlot();
      try {
        next.resolve(await run(next.item));
      } catch (error) {
        // A failing flush rejects only its own submit; the worker keeps going.
        next.reject(error);
      }
    }
    pumping = false;
    for (const notify of idleWaiters.splice(0)) {
      notify();
    }
  };

  const submit = (item: TItem, signal?: AbortSignal): Promise<TResult> => {
    if (closed) {
      return Promise.reject(new Error("serial flush worker is closed"));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    return new Promise<TResult>((resolve, reject) => {
      const enqueue = (): void => {
        queue.push({ item, reject, resolve });
        pump().catch(reject);
      };
      if (queue.length < capacity) {
        enqueue();
        return;
      }
      let abortedWhileParked = false;
      const onAbort = (): void => {
        abortedWhileParked = true;
        reject(signal?.reason);
      };
      const waiter: SlotWaiter = {
        grant: (): boolean => {
          signal?.removeEventListener("abort", onAbort);
          if (abortedWhileParked) {
            return false;
          }
          enqueue();
          return true;
        },
        reject: (reason: unknown): void => {
          signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
      };
      slotWaiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const createReservation = (weight: number): FlushReservation<TItem, TResult> => {
    let freed = false;
    /*
     * A reservation's weight is freed exactly once: by release() or when its
     * submitted run settles. Further calls are no-ops so the budget never
     * goes negative and admits unbounded reservations.
     */
    const free = (): void => {
      if (freed) {
        return;
      }
      freed = true;
      outstandingWeight -= weight;
      grantWeight();
    };
    const reservationSubmit = (item: TItem): Promise<TResult> => {
      if (closed) {
        free();
        return Promise.reject(new Error("serial flush worker is closed"));
      }
      // The weight already bounds this payload, so no item-count gating here.
      return new Promise<TResult>((resolve, reject) => {
        queue.push({
          item,
          reject: (reason: unknown): void => {
            free();
            reject(reason);
          },
          resolve: (value: TResult): void => {
            free();
            resolve(value);
          },
        });
        pump().catch((error: unknown) => {
          free();
          reject(error);
        });
      });
    };
    return { release: free, submit: reservationSubmit };
  };

  const reserve = (
    weight: number,
    signal?: AbortSignal,
  ): Promise<FlushReservation<TItem, TResult>> => {
    if (closed) {
      return Promise.reject(new Error("serial flush worker is closed"));
    }
    if (typeof budget !== "number") {
      return Promise.reject(new Error("reserve requires a budget"));
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    /*
     * Whale rule: a payload heavier than the whole budget clamps to the full
     * budget and is granted when the worker is otherwise idle, never deadlocking.
     */
    const clamped = Math.min(weight, budget);
    return new Promise<FlushReservation<TItem, TResult>>((resolve, reject) => {
      const grantNow = (): void => {
        outstandingWeight += clamped;
        resolve(createReservation(clamped));
      };
      if (weightWaiters.length === 0 && outstandingWeight + clamped <= budget) {
        grantNow();
        return;
      }
      /*
       * An abort while parked acquired nothing, so it must free nothing: the
       * waiter marks itself aborted and grantWeight drops it from the FIFO
       * without ever touching outstandingWeight.
       */
      let abortedWhileParked = false;
      const onAbort = (): void => {
        abortedWhileParked = true;
        reject(signal?.reason);
      };
      const waiter: WeightWaiter = {
        aborted: (): boolean => abortedWhileParked,
        grant: (): void => {
          signal?.removeEventListener("abort", onAbort);
          grantNow();
        },
        reject: (reason: unknown): void => {
          signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
        weight: clamped,
      };
      weightWaiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const close = (): Promise<void> => {
    closed = true;
    // Parked submits never made it into the queue; they cannot drain.
    for (const waiter of slotWaiters.splice(0)) {
      waiter.reject(new Error("serial flush worker is closed"));
    }
    // Parked reservers hold no weight yet; they cannot be granted after close.
    for (const waiter of weightWaiters.splice(0)) {
      waiter.reject(new Error("serial flush worker is closed"));
    }
    if (!pumping && queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  return { close, reserve, submit };
};

export { createSerialFlushWorker };
export type { FlushReservation, SerialFlushWorker, SerialFlushWorkerOptions };
