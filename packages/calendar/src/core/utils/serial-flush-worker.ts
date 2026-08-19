const DEFAULT_CAPACITY = 50;

/*
 * Shutdown rejections are infrastructure, not payload or provider failures.
 * Callers that classify errors (for example provider ingest backoff) must be
 * able to recognize a closed writer without matching on message text.
 */
class SerialFlushWorkerClosedError extends Error {
  constructor() {
    super("serial flush worker is closed");
    this.name = "SerialFlushWorkerClosedError";
  }
}

const isSerialFlushWorkerClosedError = (error: unknown): boolean =>
  error instanceof SerialFlushWorkerClosedError;

/*
 * Run-deadline rejections are likewise infrastructure: the pump's client-side
 * deadline fired while a wedged flush held the writer, so the caller's
 * provider was never at fault. Callers classifying errors must be able to
 * recognize this without matching on message text.
 */
class SerialFlushRunDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`serial flush run exceeded ${deadlineMs}ms deadline`);
    this.name = "SerialFlushRunDeadlineError";
  }
}

const isSerialFlushRunDeadlineError = (error: unknown): boolean =>
  error instanceof SerialFlushRunDeadlineError;

/*
 * A reserve abort fired while the caller was still parked on the worker's own
 * budget — reserve-before-fetch ordering means the caller's provider was never
 * contacted — so error classifiers must be able to tell this apart from the
 * same deadline error class raised later, during a provider fetch. The abort
 * reason is flagged in place (never wrapped) so its identity and class are
 * preserved for callers that assert on either.
 */
const RESERVE_ABORT_FLAG = "serialFlushReserveAborted";

const flagReserveAbortReason = (reason: unknown): void => {
  if (reason instanceof Error) {
    Object.assign(reason, { [RESERVE_ABORT_FLAG]: true });
  }
};

const isSerialFlushReserveAbortError = (error: unknown): boolean =>
  error instanceof Error &&
  (error as Error & Record<string, unknown>)[RESERVE_ABORT_FLAG] === true;
/*
 * Express lane for tiny reservations. Large reservations (cold-start fetches
 * sized at an eighth of the budget) can pin 100% of the budget while their
 * fetches merely sleep in a provider rate limiter, which would park every
 * other caller of the shared worker in the FIFO. A reservation no heavier
 * than budget/64 may instead be admitted immediately, oversubscribing the
 * budget by at most budget/16, so healthy small work keeps flowing while the
 * heavy holds drain. The oversubscription is bounded: once outstanding
 * weight reaches budget + budget/16, tiny reservations park like everyone else.
 */
const EXPRESS_WEIGHT_DIVISOR = 64;
const EXPRESS_HEADROOM_DIVISOR = 16;
/*
 * Anti-starvation bound: at most this many express grants may overtake a
 * parked FIFO head. Once reached, the head is admitted under the same
 * oversubscription ceiling the express lane uses, so sustained tiny traffic
 * cannot park a cold-start or large-calendar reservation past its deadline
 * while worst-case memory stays within budget + budget/16.
 */
const EXPRESS_MAX_OVERTAKES = 16;
// Client-side bound on a single flush: any sane server-side deadline is far below this.
const DEFAULT_RUN_DEADLINE_MS = 600_000;

const resolveRunDeadlineMs = (item: unknown): number => {
  /*
   * Honor an item-carried absolute deadline when present; otherwise fall back.
   * Items may be plain objects or callable thunks (the production ingest
   * caller submits `() => task()` functions with a `deadlineAt` attached),
   * so the probe must accept both typeof shapes.
   */
  const carriesProperties = typeof item === "object" || typeof item === "function";
  if (carriesProperties && item !== null && "deadlineAt" in item) {
    const { deadlineAt } = item as { deadlineAt: unknown };
    if (typeof deadlineAt === "number" && Number.isFinite(deadlineAt)) {
      return Math.max(deadlineAt - Date.now(), 0);
    }
  }
  return DEFAULT_RUN_DEADLINE_MS;
};

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
  // Runs when the item's run() actually settles, even after a deadline expiry.
  settle?: () => void;
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
  // Express grants that have overtaken the currently parked FIFO head.
  let expressOvertakes = 0;
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
        // Overtakes were counted against the dropped head; the lane reopens.
        expressOvertakes = 0;
        continue;
      }
      if (outstandingWeight + head.weight > budget) {
        return;
      }
      weightWaiters.shift();
      expressOvertakes = 0;
      head.grant();
    }
  };

  /*
   * Aged admission for a head the express lane has overtaken too many times:
   * grant it under the express oversubscription ceiling instead of the plain
   * budget, so express churn that keeps outstanding weight high cannot defer
   * it forever. Admits at most the head; the rest of the FIFO still drains
   * through grantWeight under the normal budget.
   */
  const grantOvertakenHead = (): void => {
    if (typeof budget !== "number") {
      return;
    }
    const ceiling = budget + budget / EXPRESS_HEADROOM_DIVISOR;
    while (weightWaiters.length > 0) {
      const [head] = weightWaiters;
      if (!head) {
        return;
      }
      if (head.aborted()) {
        // An aborted waiter already rejected; drop it so it cannot block the line.
        weightWaiters.shift();
        // Overtakes were counted against the dropped head; the lane reopens.
        expressOvertakes = 0;
        continue;
      }
      if (outstandingWeight + head.weight > ceiling) {
        return;
      }
      weightWaiters.shift();
      expressOvertakes = 0;
      head.grant();
      return;
    }
  };

  /*
   * A half-open connection can leave `run` pending forever, making server-side
   * timeouts unreachable. Racing each run against a client-side deadline keeps
   * one wedged flush from stalling every family's persistence until restart.
   * The deadline only rejects the caller's promise: the run itself is awaited
   * to settlement, so a timed-out run keeps its reserved weight, keeps the
   * pump blocked (runs stay strictly serial), and keeps close() waiting while
   * its flushDatabase transaction is still live.
   */
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
      const deadlineMs = resolveRunDeadlineMs(next.item);
      let deadlineExpired = false;
      const timer = setTimeout(() => {
        deadlineExpired = true;
        next.reject(new SerialFlushRunDeadlineError(deadlineMs));
      }, deadlineMs);
      try {
        const value = await run(next.item);
        if (!deadlineExpired) {
          next.resolve(value);
        }
      } catch (error) {
        // A failing flush rejects only its own submit; the worker keeps going.
        if (!deadlineExpired) {
          next.reject(error);
        }
      } finally {
        clearTimeout(timer);
        if (next.settle) {
          next.settle();
        }
      }
    }
    pumping = false;
    for (const notify of idleWaiters.splice(0)) {
      notify();
    }
  };

  const submit = (item: TItem, signal?: AbortSignal): Promise<TResult> => {
    if (closed) {
      return Promise.reject(new SerialFlushWorkerClosedError());
    }
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }
    return new Promise<TResult>((resolve, reject) => {
      const enqueue = (): void => {
        const detach = new AbortController();
        const entry: QueuedItem<TItem, TResult> = {
          item,
          reject: (reason: unknown): void => {
            detach.abort();
            reject(reason);
          },
          resolve: (value: TResult): void => {
            detach.abort();
            resolve(value);
          },
        };
        /*
         * A queued item must observe its signal: abort removes and rejects it
         * at its deadline instead of waiting for the pump to drain to it.
         */
        const onQueuedAbort = (): void => {
          const index = queue.indexOf(entry);
          if (index === -1) {
            // Already dequeued by the pump; its own settlement handles cleanup.
            return;
          }
          queue.splice(index, 1);
          // Removing a queued item frees a slot for a parked submit.
          grantSlot();
          reject(signal?.reason);
        };
        queue.push(entry);
        signal?.addEventListener("abort", onQueuedAbort, { once: true, signal: detach.signal });
        pump().catch(entry.reject);
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
    let submitted = false;
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
    /*
     * Callers release() in a finally that also runs when submit() rejected on
     * a deadline expiry, while the abandoned run still holds its payload and
     * its flushDatabase transaction. After a submit, settle is therefore the
     * ONLY path that may free the weight; release() only covers reservations
     * that never submitted, so a fetch failure cannot strand weight forever.
     */
    const release = (): void => {
      if (submitted) {
        return;
      }
      free();
    };
    const reservationSubmit = (item: TItem): Promise<TResult> => {
      submitted = true;
      if (closed) {
        free();
        return Promise.reject(new SerialFlushWorkerClosedError());
      }
      // The weight already bounds this payload, so no item-count gating here.
      return new Promise<TResult>((resolve, reject) => {
        /*
         * The weight is freed by `settle`, which fires only when run() itself
         * settles — a deadline expiry rejects the caller but must NOT return
         * the weight to the budget while the abandoned run still holds its
         * payload and its flushDatabase transaction.
         */
        queue.push({
          item,
          reject,
          resolve,
          settle: free,
        });
        pump().catch((error: unknown) => {
          free();
          reject(error);
        });
      });
    };
    return { release, submit: reservationSubmit };
  };

  const reserve = (
    weight: number,
    signal?: AbortSignal,
  ): Promise<FlushReservation<TItem, TResult>> => {
    if (closed) {
      return Promise.reject(new SerialFlushWorkerClosedError());
    }
    if (typeof budget !== "number") {
      return Promise.reject(new Error("reserve requires a budget"));
    }
    if (signal?.aborted) {
      // The deadline burned out before the provider fetch could even be gated.
      flagReserveAbortReason(signal.reason);
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
       * Express lane: a tiny reservation must not stall behind heavy holds
       * that are only waiting on their providers. Bounded oversubscription
       * keeps memory within budget + budget/16 in the worst case.
       */
      const expressCeiling = budget + budget / EXPRESS_HEADROOM_DIVISOR;
      /*
       * Fairness: once the overtake bound is reached, the express lane pauses
       * and tiny reservations park like everyone else, so releases drain
       * outstanding weight until the parked head fits and is admitted (which
       * resets the counter and reopens the lane).
       */
      if (
        clamped <= budget / EXPRESS_WEIGHT_DIVISOR &&
        expressOvertakes < EXPRESS_MAX_OVERTAKES &&
        outstandingWeight + clamped <= expressCeiling
      ) {
        if (weightWaiters.length > 0) {
          expressOvertakes += 1;
        }
        grantNow();
        // Fairness: after enough overtakes the parked head must be admitted.
        if (expressOvertakes >= EXPRESS_MAX_OVERTAKES) {
          grantOvertakenHead();
        }
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
        flagReserveAbortReason(signal?.reason);
        reject(signal?.reason);
        /*
         * Reap immediately: if this waiter is the FIFO head, waiting for the
         * next release would leave a phantom head disabling the fast path and
         * parking reservations that fit the budget right now.
         */
        grantWeight();
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
      waiter.reject(new SerialFlushWorkerClosedError());
    }
    // Parked reservers hold no weight yet; they cannot be granted after close.
    for (const waiter of weightWaiters.splice(0)) {
      waiter.reject(new SerialFlushWorkerClosedError());
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

export {
  createSerialFlushWorker,
  isSerialFlushReserveAbortError,
  isSerialFlushRunDeadlineError,
  isSerialFlushWorkerClosedError,
  SerialFlushRunDeadlineError,
  SerialFlushWorkerClosedError,
};
export type { FlushReservation, SerialFlushWorker, SerialFlushWorkerOptions };
