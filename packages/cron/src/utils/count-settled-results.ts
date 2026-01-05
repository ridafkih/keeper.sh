/**
 * Counts the number of fulfilled and rejected promises from Promise.allSettled results.
 */
const countSettledResults = <TResult>(
  results: PromiseSettledResult<TResult>[],
): { succeeded: number; failed: number } => {
  const report = {
    failed: 0,
    succeeded: 0,
  };

  for (const result of results) {
    if (result.status === "fulfilled") {
      report.succeeded++;
      continue;
    }

    if (result.status === "rejected") {
      report.failed++;
      continue;
    }
  }

  return report;
};

export { countSettledResults };
