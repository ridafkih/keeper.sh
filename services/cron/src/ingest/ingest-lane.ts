interface IngestLaneClaim {
  calendarId: string;
}

interface IngestLaneOptions<TClaim extends IngestLaneClaim> {
  batchSize: number;
  capacity: number;
  claim: (limit: number) => Promise<TClaim[]>;
  idleMs: number;
  onError: (error: unknown, phase: "claim" | "round") => void;
  runRound: (claims: TClaim[]) => Promise<unknown>;
}

interface IngestLane<TClaim extends IngestLaneClaim> {
  inFlight: () => number;
  pendingClaims: () => TClaim[];
  stop: () => Promise<void>;
}

interface Waiter {
  promise: Promise<null>;
  release: () => void;
}

const createWaiter = (): Waiter => {
  const { promise, resolve } = Promise.withResolvers<null>();
  return { promise, release: () => resolve(null) };
};

const startIngestLane = <TClaim extends IngestLaneClaim>(
  options: IngestLaneOptions<TClaim>,
): IngestLane<TClaim> => {
  const lifecycle = { stopped: false };
  let inFlight = 0;
  let waiter = createWaiter();
  const rounds = new Set<Promise<unknown>>();
  const pending = new Set<TClaim>();

  const notify = (): void => {
    const current = waiter;
    waiter = createWaiter();
    current.release();
  };

  const pause = async (delayMs: number): Promise<void> => {
    const current = waiter.promise;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const elapsed = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, delayMs);
    });
    try {
      await Promise.race([current, elapsed]);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  };

  const launchRound = (claims: TClaim[]): void => {
    inFlight += claims.length;
    for (const claim of claims) {
      pending.add(claim);
    }
    const round = options.runRound(claims)
      .catch((error: unknown) => options.onError(error, "round"))
      .finally(() => {
        inFlight -= claims.length;
        for (const claim of claims) {
          pending.delete(claim);
        }
        rounds.delete(round);
        notify();
      });
    rounds.add(round);
  };

  const claimNext = async (): Promise<TClaim[] | null> => {
    try {
      return await options.claim(Math.min(options.batchSize, options.capacity - inFlight));
    } catch (error) {
      options.onError(error, "claim");
      return null;
    }
  };

  const loop = async (): Promise<void> => {
    while (!lifecycle.stopped) {
      if (inFlight >= options.capacity) {
        await waiter.promise;
        continue;
      }
      const claims = await claimNext();
      if (lifecycle.stopped) {
        if (claims && claims.length > 0) {
          launchRound(claims);
        }
        return;
      }
      if (!claims || claims.length === 0) {
        await pause(options.idleMs);
        continue;
      }
      launchRound(claims);
    }
  };

  const running = loop();

  return {
    inFlight: () => inFlight,
    pendingClaims: () => [...pending],
    stop: async (): Promise<void> => {
      lifecycle.stopped = true;
      notify();
      await running;
      await Promise.all(rounds);
    },
  };
};

export { startIngestLane };
export type { IngestLane, IngestLaneClaim, IngestLaneOptions };
