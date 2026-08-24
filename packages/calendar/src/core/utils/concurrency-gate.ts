interface ConcurrencyGate {
  run: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
  hasFreePermit: () => boolean;
  inFlight: () => number;
}

const createConcurrencyGate = (limit: number): ConcurrencyGate => {
  const waiters: (() => void)[] = [];
  let inFlight = 0;

  const release = (): void => {
    const next = waiters.shift();
    if (next) {
      next();
      return;
    }
    inFlight -= 1;
  };

  const acquire = async (): Promise<void> => {
    if (inFlight < limit) {
      inFlight += 1;
      return;
    }
    await new Promise<null>((resolve) => {
      waiters.push(() => resolve(null));
    });
  };

  return {
    hasFreePermit: () => inFlight < limit,
    inFlight: () => inFlight,
    run: async <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
      await acquire();
      try {
        return await operation();
      } finally {
        release();
      }
    },
  };
};

export { createConcurrencyGate };
export type { ConcurrencyGate };
