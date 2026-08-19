const DEFAULT_CAPACITY = 50;
const DEFAULT_WRITER_CONCURRENCY = 1;

/* Distinct class so error classifiers recognize a closed writer without matching message text. */
class SerialFlushWorkerClosedError extends Error {
  constructor() {
    super("serial flush worker is closed");
    this.name = "SerialFlushWorkerClosedError";
  }
}

const isSerialFlushWorkerClosedError = (error: unknown): boolean =>
  error instanceof SerialFlushWorkerClosedError;

/* Infrastructure, not a provider fault: a wedged flush held the writer past the deadline. */
class SerialFlushRunDeadlineError extends Error {
  constructor(deadlineMs: number) {
    super(`serial flush run exceeded ${deadlineMs}ms deadline`);
    this.name = "SerialFlushRunDeadlineError";
  }
}

const isSerialFlushRunDeadlineError = (error: unknown): boolean =>
  error instanceof SerialFlushRunDeadlineError;

/*
 * Marks a deadline that expired while parked on the budget, before the provider was ever
 * contacted, so classifiers can tell it from the same error class raised during a fetch.
 * Flagged in place, never wrapped, so the reason's identity and class survive for callers
 * that assert on either.
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
 * A heavy reservation sleeping in a provider rate limiter would otherwise park every other
 * caller. Reservations no heavier than budget/64 skip the FIFO, capping worst-case memory
 * at budget + budget/16.
 */
const EXPRESS_WEIGHT_DIVISOR = 64;
const EXPRESS_HEADROOM_DIVISOR = 16;
/* Bounds the starvation the express lane can inflict on a parked FIFO head. */
const EXPRESS_MAX_OVERTAKES = 16;
// Client-side bound on a single flush: any sane server-side deadline is far below this.
const DEFAULT_RUN_DEADLINE_MS = 600_000;

const resolveRunDeadlineMs = (item: unknown): number => {
  /*
   * The ingest caller submits `() => task()` thunks with `deadlineAt` attached, so this
   * probe must accept functions as well as plain objects.
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

const resolvePrepare = (item: unknown): (() => unknown) | null => {
  const carriesProperties = typeof item === "object" || typeof item === "function";
  if (carriesProperties && item !== null && "prepare" in item) {
    const { prepare } = item as { prepare: unknown };
    if (typeof prepare === "function") {
      return prepare as () => unknown;
    }
  }
  return null;
};

interface SerialFlushWorkerOptions {
  budget?: number;
  capacity?: number;
  writerConcurrency?: number;
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

const createSerialFlushWorker = <TItem, TResult>(
  run: (item: TItem) => Promise<TResult>,
  options?: SerialFlushWorkerOptions,
): SerialFlushWorker<TItem, TResult> => {
  const capacity = options?.capacity ?? DEFAULT_CAPACITY;
  const writerConcurrency = options?.writerConcurrency ?? DEFAULT_WRITER_CONCURRENCY;
  const budget = options?.budget;
  const queue: QueuedItem<TItem, TResult>[] = [];
  const slotWaiters: SlotWaiter[] = [];
  const weightWaiters: WeightWaiter[] = [];
  const idleWaiters: (() => void)[] = [];
  const writerSlotWaiters: (() => void)[] = [];
  const writerSlotFreeWaiters: (() => void)[] = [];
  let inFlight = 0;
  let writerSlotsInUse = 0;
  let outstandingWeight = 0;
  let expressOvertakes = 0;
  let closed = false;
  let pumping = false;

  const grantSlot = (): void => {
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
    while (weightWaiters.length > 0) {
      const [head] = weightWaiters;
      if (!head) {
        return;
      }
      if (head.aborted()) {
        weightWaiters.shift();
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

  /* Admits the head above the plain budget so express churn cannot defer it forever. */
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
        weightWaiters.shift();
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

  const notifyIfIdle = (): void => {
    if (pumping || inFlight > 0 || queue.length > 0) {
      return;
    }
    for (const notify of idleWaiters.splice(0)) {
      notify();
    }
  };

  const claimWriterSlot = (): boolean => {
    if (writerSlotsInUse >= writerConcurrency) {
      return false;
    }
    writerSlotsInUse += 1;
    return true;
  };

  const whenWriterSlotOwned = (): Promise<void> => new Promise((resolve) => {
    writerSlotWaiters.push(resolve);
  });

  const whenWriterSlotFree = (): Promise<void> => new Promise((resolve) => {
    writerSlotFreeWaiters.push(resolve);
  });

  /* Handed straight to the next owner so the slot count cannot race a re-check. */
  const releaseWriterSlot = (): void => {
    const nextOwner = writerSlotWaiters.shift();
    if (nextOwner) {
      nextOwner();
      return;
    }
    writerSlotsInUse -= 1;
    for (const notify of writerSlotFreeWaiters.splice(0)) {
      notify();
    }
  };

  /*
   * A half-open connection can leave `run` pending forever, making server-side timeouts
   * unreachable. The deadline rejects only the caller's promise: the run is still awaited to
   * settlement, so it keeps its weight, keeps the writer slot, and keeps close() waiting
   * while its flushDatabase transaction is live.
   */
  const startItem = (next: QueuedItem<TItem, TResult>): Promise<unknown> => {
    const admitted = Promise.withResolvers<null>();
    const deadlineMs = resolveRunDeadlineMs(next.item);
    let deadlineExpired = false;
    const timer = setTimeout(() => {
      deadlineExpired = true;
      next.reject(new SerialFlushRunDeadlineError(deadlineMs));
    }, deadlineMs);
    const finish = (): void => {
      clearTimeout(timer);
      inFlight -= 1;
      if (next.settle) {
        next.settle();
      }
      notifyIfIdle();
    };
    inFlight += 1;
    const prepare = resolvePrepare(next.item);
    const runLifecycle = async (): Promise<void> => {
      if (prepare) {
        try {
          const prepared = await prepare() ?? null;
          if (prepared !== null) {
            if (!deadlineExpired) {
              next.resolve(prepared as TResult);
            }
            admitted.resolve(null);
            finish();
            return;
          }
        } catch (error) {
          if (!deadlineExpired) {
            next.reject(error);
          }
          admitted.resolve(null);
          finish();
          return;
        }
      }
      if (!claimWriterSlot()) {
        await whenWriterSlotOwned();
      }
      admitted.resolve(null);
      try {
        const value = await run(next.item);
        if (!deadlineExpired) {
          next.resolve(value);
        }
      } catch (error) {
        if (!deadlineExpired) {
          next.reject(error);
        }
      } finally {
        releaseWriterSlot();
        finish();
      }
    };
    runLifecycle().catch(next.reject);
    /*
     * A settled preparation must claim the writer slot before the next dequeue, or a whole
     * backlog would prepare in one sweep and the last item's currency probe would predate
     * its run by every run queued ahead of it.
     */
    return Promise.race([admitted.promise, Promise.resolve()]);
  };

  const pump = async (): Promise<void> => {
    if (pumping) {
      return;
    }
    pumping = true;
    while (queue.length > 0) {
      if (writerSlotsInUse >= writerConcurrency) {
        await whenWriterSlotFree();
        continue;
      }
      const next = queue.shift();
      if (!next) {
        break;
      }
      grantSlot();
      await startItem(next);
    }
    pumping = false;
    notifyIfIdle();
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
        const onQueuedAbort = (): void => {
          const index = queue.indexOf(entry);
          if (index === -1) {
            return;
          }
          queue.splice(index, 1);
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
    /* Idempotent: a double free would drive the budget negative and admit unbounded work. */
    const free = (): void => {
      if (freed) {
        return;
      }
      freed = true;
      outstandingWeight -= weight;
      grantWeight();
    };
    /*
     * A no-op after submit, deliberately: callers release() in a finally that also runs when
     * submit() rejected on a deadline, while the abandoned run still holds its payload and
     * transaction. Past submit, only settle may free the weight.
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
      return new Promise<TResult>((resolve, reject) => {
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
      /*
       * No park flag here: an already-consumed deadline may have been eaten by
       * a provider call that takes no signal, and stamping it would exempt a
       * provider-consumed deadline from ingest backoff. Only an abort observed
       * while actually parked below is pre-contact.
       */
      return Promise.reject(signal.reason);
    }
    /* A payload heavier than the whole budget clamps to it rather than deadlocking forever. */
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
      const expressCeiling = budget + budget / EXPRESS_HEADROOM_DIVISOR;
      if (
        clamped <= budget / EXPRESS_WEIGHT_DIVISOR &&
        expressOvertakes < EXPRESS_MAX_OVERTAKES &&
        outstandingWeight + clamped <= expressCeiling
      ) {
        if (weightWaiters.length > 0) {
          expressOvertakes += 1;
        }
        grantNow();
        if (expressOvertakes >= EXPRESS_MAX_OVERTAKES) {
          grantOvertakenHead();
        }
        return;
      }
      /* A park abort acquired nothing, so it must free nothing. */
      let abortedWhileParked = false;
      const onAbort = (): void => {
        abortedWhileParked = true;
        flagReserveAbortReason(signal?.reason);
        reject(signal?.reason);
        /* Reaped now: a phantom head would disable the fast path for reservations that fit. */
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
    for (const waiter of slotWaiters.splice(0)) {
      waiter.reject(new SerialFlushWorkerClosedError());
    }
    for (const waiter of weightWaiters.splice(0)) {
      waiter.reject(new SerialFlushWorkerClosedError());
    }
    if (!pumping && inFlight === 0 && queue.length === 0) {
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
