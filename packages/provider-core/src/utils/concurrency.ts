const DEFAULT_CONCURRENCY = 5;

interface AllSettledWithConcurrencyOptions {
  concurrency?: number;
}

/**
 * Like Promise.allSettled, but limits how many promises run concurrently.
 * Prevents unbounded parallelism from exhausting DB connections or API limits.
 */
const allSettledWithConcurrency = async <TResult>(
  tasks: (() => Promise<TResult>)[],
  options: AllSettledWithConcurrencyOptions = {},
): Promise<PromiseSettledResult<TResult>[]> => {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results: PromiseSettledResult<TResult>[] = Array.from({ length: tasks.length });
  let nextIndex = 0;

  const runNext = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex++;

      const task = tasks[index];
      if (!task) {
        continue;
      }

      try {
        const value = await task();
        results[index] = { status: "fulfilled", value };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  };

  const workerCount = Math.min(concurrency, tasks.length);
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    workers.push(runNext());
  }

  await Promise.all(workers);

  return results;
};

export { allSettledWithConcurrency };
export type { AllSettledWithConcurrencyOptions };
