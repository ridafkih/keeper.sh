interface InFlightDrainRegistry {
  register: (work: Promise<unknown>) => void;
  settle: () => Promise<void>;
}

const createInFlightDrainRegistry = (): InFlightDrainRegistry => {
  const inFlight = new Map<number, Promise<unknown>>();
  let nextId = 0;
  return {
    register: (work: Promise<unknown>): void => {
      const id = nextId;
      nextId += 1;
      inFlight.set(id, work.then(
        () => inFlight.delete(id),
        () => inFlight.delete(id),
      ));
    },
    settle: async (): Promise<void> => {
      await Promise.all(inFlight.values());
    },
  };
};

export { createInFlightDrainRegistry };
export type { InFlightDrainRegistry };
