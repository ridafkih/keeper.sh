const dayMs = 24 * 60 * 60 * 1000;

const microsoftLimits = {
  pageSize: 50,
  maxPages: 20,
  mailboxConcurrency: 4,
  retryAfterCeilingMs: 64_000,
  maximumCoverageMs: 366 * dayMs,
  diagnosticSampleEntries: 20,
  diagnosticSampleUtf16Length: 2048,
  pushBodyMaxBytes: 65_536,
  validationTokenMaxLength: 2048,
  clientStateMaxLength: 128,
  idempotencyCandidateCeiling: 8,
} as const;

type MicrosoftLimits = typeof microsoftLimits;

export { microsoftLimits };
export type { MicrosoftLimits };
