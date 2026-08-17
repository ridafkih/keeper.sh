import type { Semaphore } from "../../src/client/semaphore";

interface CountingSemaphore {
  readonly semaphore: Semaphore;
  readonly acquisitions: () => number;
  readonly releases: () => number;
  readonly held: () => number;
}

const countingSemaphore = (permits: number): CountingSemaphore => {
  let acquisitions = 0;
  let releases = 0;
  let held = 0;
  const semaphore: Semaphore = {
    withPermit: async <Value>(signal: AbortSignal, body: () => Promise<Value>): Promise<Value> => {
      acquisitions += 1;
      held += 1;
      try {
        return await body();
      } finally {
        held -= 1;
        releases += 1;
      }
    },
    available: () => permits - held,
    waiting: () => 0,
  };
  return {
    semaphore,
    acquisitions: () => acquisitions,
    releases: () => releases,
    held: () => held,
  };
};

export { countingSemaphore };
export type { CountingSemaphore };
