import { GOOGLE_PUSH_REQUESTS_PER_MINUTE, OUTLOOK_REQUESTS_PER_MINUTE } from "@keeper.sh/constants";
import type { SyncPace, SyncProgressUpdate } from "@keeper.sh/calendar";

type ProgressListener = (update: SyncProgressUpdate) => void;

const PUSH_OPERATIONS_PER_MINUTE_BY_PROVIDER: Readonly<Record<string, number>> = {
  google: GOOGLE_PUSH_REQUESTS_PER_MINUTE,
  outlook: OUTLOOK_REQUESTS_PER_MINUTE,
};

const resolvePushPace = (provider: string): SyncPace | null => {
  const operationsPerMinute = PUSH_OPERATIONS_PER_MINUTE_BY_PROVIDER[provider];
  if (typeof operationsPerMinute !== "number") {
    return null;
  }
  return { lane: provider, operationsPerMinute };
};

const withPushPace = (
  provider: string,
  onProgress: ProgressListener | undefined,
): ProgressListener | undefined => {
  const pace = resolvePushPace(provider);
  if (!onProgress || !pace) {
    return onProgress;
  }
  return (update) => onProgress({ ...update, pace });
};

export { resolvePushPace, withPushPace };
