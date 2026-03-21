const BASE_DELAY_MS = 5 * 60 * 1000;
const DISABLE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface BackoffResult {
  delayMs: number;
  shouldDisable: boolean;
}

const computeDestinationBackoff = (failureCount: number): BackoffResult => {
  if (failureCount <= 0) {
    return { delayMs: 0, shouldDisable: false };
  }

  const uncappedDelayMs = BASE_DELAY_MS * (2 ** (failureCount - 1));
  const delayMs = Math.min(uncappedDelayMs, DISABLE_THRESHOLD_MS);

  return {
    delayMs,
    shouldDisable: uncappedDelayMs >= DISABLE_THRESHOLD_MS,
  };
};

export { computeDestinationBackoff, BASE_DELAY_MS, DISABLE_THRESHOLD_MS };
export type { BackoffResult };
