import type { Instant } from "@keeper.sh/sync-protocol";

const canonicalUtcInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const isCanonicalUtcInstant = (instant: Instant): boolean =>
  canonicalUtcInstant.test(instant.value);

const compareCanonicalUtcInstants = (left: Instant, right: Instant): number => {
  if (left.value < right.value) {
    return -1;
  }
  if (left.value > right.value) {
    return 1;
  }
  return 0;
};

const isRecordedInstant = (instant: Instant | null | undefined): instant is Instant =>
  (instant ?? null) !== null;

export { compareCanonicalUtcInstants, isCanonicalUtcInstant, isRecordedInstant };
