const DEFAULT_CAPACITY = 50;

interface SerialFlushWorkerOptions {
  capacity?: number;
}

interface SerialFlushWorker<TItem, TResult> {
  close(): Promise<void>;
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

/*
 * Bounded serial worker: many callers may submit concurrently, but `run` is
 * invoked one item at a time in submission order. Once `capacity` items are
 * queued, further submits park until a slot frees, so queued memory stays
 * bounded no matter how fast producers go.
 */
const createSerialFlushWorker = <TItem, TResult>(
  run: (item: TItem) => Promise<TResult>,
  options?: SerialFlushWorkerOptions,
): SerialFlushWorker<TItem, TResult> => {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const queue: QueuedItem<TItem, TResult>[] = [];
  const slotWaiters: SlotWaiter[] = [];
  const idleWaiters: (() => void)[] = [];
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

  const close = (): Promise<void> => {
    closed = true;
    // Parked submits never made it into the queue; they cannot drain.
    for (const waiter of slotWaiters.splice(0)) {
      waiter.reject(new Error("serial flush worker is closed"));
    }
    if (!pumping && queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  return { close, submit };
};

export { createSerialFlushWorker };
export type { SerialFlushWorker, SerialFlushWorkerOptions };
