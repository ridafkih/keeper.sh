import type { RedisRateLimiter, SyncProgressUpdate } from "@keeper.sh/calendar";

interface PlannedPushWrites {
  calendarId: string;
  operationCount: number;
  requestsPerMinute: number | null;
}

type ProgressListener = (update: SyncProgressUpdate) => void;
type PlannedPushWritesListener = (plan: PlannedPushWrites) => void;

const resolvePushRequestsPerMinute = async (
  rateLimiter: RedisRateLimiter | undefined,
): Promise<number | null> => {
  const requestsPerMinute = await rateLimiter?.currentRequestsPerMinute?.();
  if (typeof requestsPerMinute !== "number") {
    return null;
  }
  return requestsPerMinute;
};

const withPlannedPushWrites = (
  requestsPerMinute: number | null,
  onWritesPlanned: PlannedPushWritesListener,
  onProgress: ProgressListener | undefined,
): ProgressListener => {
  let isPlanAnnounced = false;
  return (update) => {
    if (!isPlanAnnounced && update.stage === "processing" && update.progress) {
      isPlanAnnounced = true;
      onWritesPlanned({
        calendarId: update.calendarId,
        operationCount: update.progress.total - update.progress.current,
        requestsPerMinute,
      });
    }
    onProgress?.(update);
  };
};

export { resolvePushRequestsPerMinute, withPlannedPushWrites };
export type { PlannedPushWritesListener };
