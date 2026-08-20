import { createDefaultDependencies } from "@/jobs/drain-pending-ingest";
import { createPendingSignalReader } from "@/utils/pending-signal-consumer";
import { createScopedClaimPending } from "@/utils/scoped-drain-pending-ingest";
import { runDrainPendingIngest } from "@/utils/drain-pending-ingest";
import { context, widelog } from "@/utils/logging";
import { recordStartedSignalReader } from "@/utils/signal-reader-state";
import type { BlockingSignalRedis, PendingSignalConsumer } from "@/utils/pending-signal-consumer";
import type { ScopedClaimRedis } from "@/utils/scoped-drain-pending-ingest";

const SIGNAL_DRAIN_CONCURRENCY = 4;
const SIGNAL_DRAIN_FAILED_SLUG = "push-signal-drain-failed";

interface PendingSignalReaderContext {
  blockingRedis: BlockingSignalRedis;
  enabled: boolean;
  scoreRedis: ScopedClaimRedis;
}

/*
 * Its own event rather than the tick's: a signalled drain answers a different question,
 * which is how long one webhook waited, and averaging it into the fleet sweep hides that.
 */
const drainSignalledCalendars = (
  scoreRedis: ScopedClaimRedis,
  calendarIds: string[],
): Promise<void> => context(async () => {
  widelog.set("operation.name", "drain-signalled-calendars");
  widelog.set("operation.type", "job");
  widelog.set("push_drain.signalled_count", calendarIds.length);
  try {
    await widelog.time.measure("duration_ms", async () => {
      const dependencies = await createDefaultDependencies();
      await runDrainPendingIngest({
        ...dependencies,
        claimPending: createScopedClaimPending(scoreRedis, calendarIds),
      });
    });
    widelog.set("outcome", "success");
  } catch (error) {
    widelog.set("outcome", "error");
    widelog.errorFields(error, { retriable: true, slug: SIGNAL_DRAIN_FAILED_SLUG });
  }
});

const startPendingSignalReader = (
  readerContext: PendingSignalReaderContext,
): PendingSignalConsumer | null => {
  if (!readerContext.enabled) {
    return null;
  }
  const reader = createPendingSignalReader({
    blockingRedis: readerContext.blockingRedis,
    concurrencyLimit: SIGNAL_DRAIN_CONCURRENCY,
    drainCalendars: (calendarIds) =>
      drainSignalledCalendars(readerContext.scoreRedis, calendarIds),
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
  });
  reader.start();
  recordStartedSignalReader(reader);
  return reader;
};

export {
  SIGNAL_DRAIN_CONCURRENCY,
  SIGNAL_DRAIN_FAILED_SLUG,
  drainSignalledCalendars,
  startPendingSignalReader,
};
export type { PendingSignalReaderContext };
