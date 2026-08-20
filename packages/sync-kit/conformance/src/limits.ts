const conformanceLimits = {
  concurrency: 4,
  fanOutTasks: 9,
  diagnosticSampleEntries: 20,
  diagnosticSampleUtf16Length: 2048,
  deadlineMs: 30_000,
  stallDeadlineMs: 50,
} as const;

type ConformanceLimits = typeof conformanceLimits;

export { conformanceLimits };
export type { ConformanceLimits };
