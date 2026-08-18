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

interface AllSettledGroupedOptions {
  groupConcurrency?: number;
  taskConcurrency?: number;
}

/*
 * Like allSettledWithConcurrency, but the unit of scheduling is the group: up to
 * groupConcurrency groups run at once, and each group runs its own tasks at
 * taskConcurrency. One group with many tasks occupies one group slot rather than
 * the whole budget, so no key can starve the others. Results come back in the
 * original task order, because callers pair settlements to inputs by index.
 */
const allSettledGroupedWithConcurrency = async <TResult>(
  tasks: (() => Promise<TResult>)[],
  groupKeys: string[],
  options: AllSettledGroupedOptions = {},
): Promise<PromiseSettledResult<TResult>[]> => {
  const groupedIndexes = new Map<string, number[]>();
  for (let index = 0; index < tasks.length; index++) {
    const key = groupKeys[index] ?? "";
    const bucket = groupedIndexes.get(key);
    if (bucket) {
      bucket.push(index);
    } else {
      groupedIndexes.set(key, [index]);
    }
  }

  const results: PromiseSettledResult<TResult>[] = Array.from({ length: tasks.length });
  const groupTasks = [...groupedIndexes.values()].map((indexes) => async () => {
    /*
     * Kept indexes and tasks stay paired: filtering tasks alone would shift every
     * later settlement onto the wrong index, and callers attribute by index.
     */
    const keptIndexes = indexes.filter((index) => Boolean(tasks[index]));
    const settled = await allSettledWithConcurrency(
      keptIndexes.flatMap((index) => {
        const task = tasks[index];
        if (!task) {
          return [];
        }
        return [task];
      }),
      { concurrency: options.taskConcurrency ?? DEFAULT_CONCURRENCY },
    );
    for (const [position, settlement] of settled.entries()) {
      const originalIndex = keptIndexes[position];
      if (typeof originalIndex === "number" && settlement) {
        results[originalIndex] = settlement;
      }
    }
  });

  await allSettledWithConcurrency(groupTasks, {
    concurrency: options.groupConcurrency ?? DEFAULT_CONCURRENCY,
  });

  return results;
};

export { allSettledGroupedWithConcurrency, allSettledWithConcurrency };
export type { AllSettledGroupedOptions, AllSettledWithConcurrencyOptions };
