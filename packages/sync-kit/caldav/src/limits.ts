interface CalDAVLimits {
  readonly multigetBatchSize: number;
  readonly syncPageCeiling: number;
  readonly collectionConcurrency: number;
  readonly diagnosticSampleSize: number;
  readonly coverageHorizonMs: number;
}

const daysInAttestableHorizon = 366;
const millisecondsInDay = 24 * 60 * 60 * 1000;

const caldavLimits = {
  multigetBatchSize: 250,
  syncPageCeiling: 20,
  collectionConcurrency: 2,
  diagnosticSampleSize: 20,
  coverageHorizonMs: daysInAttestableHorizon * millisecondsInDay,
} as const satisfies CalDAVLimits;

export { caldavLimits };
export type { CalDAVLimits };
