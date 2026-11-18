interface JobFlowOptions {
  now?: () => number;
  stallAfterMs: number;
}

interface JobFlow {
  isStalled: () => boolean;
  track: <TResult>(run: () => Promise<TResult>) => Promise<TResult>;
}

const createJobFlow = (options: JobFlowOptions): JobFlow => {
  const now = options.now ?? Date.now;
  const state = { inFlight: 0, lastMovedAt: now() };

  return {
    isStalled: () => state.inFlight > 0 && now() - state.lastMovedAt > options.stallAfterMs,
    track: async (run) => {
      state.inFlight += 1;
      state.lastMovedAt = now();
      try {
        return await run();
      } finally {
        state.inFlight -= 1;
        state.lastMovedAt = now();
      }
    },
  };
};

interface QueueProbeOptions {
  isRunning: () => boolean;
  isStalled: () => boolean;
  onProgress: () => void;
  ping: () => Promise<unknown>;
  pingTimeoutMs: number;
}

const answersWithin = async (request: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([request.then(() => true, () => false), expired]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const probeQueue = async (options: QueueProbeOptions): Promise<boolean> => {
  if (!options.isRunning() || options.isStalled()) {
    return false;
  }
  const answered = await answersWithin(options.ping(), options.pingTimeoutMs);
  if (!answered || !options.isRunning() || options.isStalled()) {
    return false;
  }
  options.onProgress();
  return true;
};

export { createJobFlow, probeQueue };
export type { JobFlow, JobFlowOptions, QueueProbeOptions };
