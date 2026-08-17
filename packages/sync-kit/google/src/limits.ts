const dayMs = 24 * 60 * 60 * 1000;

const googleListingLimits = {
  maxResults: 250,
  maxPages: 20,
  maximumCoverageMs: 366 * dayMs,
  diagnosticSampleEntries: 20,
  diagnosticSampleUtf16Length: 2048,
  mintedIdMemory: 4096,
} as const;

type GoogleListingLimits = typeof googleListingLimits;

export { googleListingLimits };
export type { GoogleListingLimits };
