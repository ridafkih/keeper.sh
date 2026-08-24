type FlushDrain = () => Promise<void>;

interface FlushDrainRegistry {
  drain: () => Promise<void>;
  register: (drain: FlushDrain) => void;
}

const createFlushDrainRegistry = (): FlushDrainRegistry => {
  const drains: FlushDrain[] = [];
  return {
    drain: async (): Promise<void> => {
      await Promise.all(drains.map((flushDrain) => flushDrain()));
    },
    register: (flushDrain: FlushDrain): void => {
      drains.push(flushDrain);
    },
  };
};

export { createFlushDrainRegistry };
export type { FlushDrain, FlushDrainRegistry };
