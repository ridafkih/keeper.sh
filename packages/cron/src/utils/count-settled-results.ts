/**
 * Counts the number of fulfilled and rejected promises from Promise.allSettled results.
 */
export const countSettledResults = <T>(
  results: PromiseSettledResult<T>[],
): { succeeded: number; failed: number } => {
  const report = {
    succeeded: 0,
    failed: 0,
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
