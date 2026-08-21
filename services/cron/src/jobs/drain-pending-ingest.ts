import type { CronOptions } from "cronbake";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import { describeSignalReader } from "@/utils/signal-reader-heartbeat";
import {
  runDrainPendingIngest,
  type DrainPendingIngestDependencies,
  type PendingIngestMember,
} from "@/utils/drain-pending-ingest";
import {
  PENDING_CORRELATION_KEY,
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
  releaseUnchangedMembers,
} from "@/utils/pending-ingest-release";
import { claimMetadataWithSeededRewake } from "@/utils/scoped-drain-pending-ingest";
import { IngestBaselineMovedAbortError } from "@/utils/ingest-baseline";
import {
  releaseClaimedCalendars,
  releaseClaimsOnFailure,
  reserveClaimedMembers,
} from "@/utils/pending-ingest-claim";

const DRAIN_LOCK_KEY = "push-drain:tick";
const DRAIN_LOCK_TTL_SECONDS = 60;
const SCORE_STRIDE = 2;

const drainWithLockRelease = async (
  dependencies: DrainPendingIngestDependencies,
  releaseLock: () => Promise<void>,
): Promise<void> => {
  try {
    await runDrainPendingIngest(dependencies);
  } finally {
    await releaseLock();
  }
};

const parsePendingMembers = (entries: string[]): PendingIngestMember[] => {
  const members: PendingIngestMember[] = [];
  for (let index = 0; index < entries.length; index += SCORE_STRIDE) {
    const calendarId = entries[index] ?? "";
    const score = Number(entries[index + 1]);
    if (calendarId.length > 0 && Number.isFinite(score)) {
      members.push({ calendarId, score });
    }
  }
  return members;
};

const createDefaultDependencies = async (): Promise<DrainPendingIngestDependencies> => {
  const { database, premiumService, refreshLockRedis } = await import("@/context");
  const { calendarsTable } = await import("@keeper.sh/database/schema");
  const { and, arrayContains, eq, inArray } = await import("drizzle-orm");
  const { ingestOAuthSources } = await import("@/jobs/ingest-sources");
  const { enqueueDestinationSyncsForUsers } = await import("@/utils/enqueue-destination-syncs");
  const { default: environment } = await import("@/env");

  return {
    claimPending: async (limit) => {
      const members = await reserveClaimedMembers(refreshLockRedis, parsePendingMembers(
        await refreshLockRedis.zrange(PENDING_INGEST_KEY, 0, limit - 1, "WITHSCORES"),
      ));
      if (members.length === 0) {
        return members;
      }
      return releaseClaimsOnFailure(refreshLockRedis, members, () =>
        claimMetadataWithSeededRewake(refreshLockRedis, members));
    },
    countPending: () => refreshLockRedis.zcard(PENDING_INGEST_KEY),
    enabled: Boolean(environment.WEBHOOK_PUBLIC_URL),
    enqueueDestinationSyncs: async (
      userIds,
      correlationIdByUserId,
      webhookReceivedAtByUserId,
    ) => {
      await enqueueDestinationSyncsForUsers(
        userIds,
        "push",
        correlationIdByUserId,
        webhookReceivedAtByUserId,
      );
    },
    ingestCalendars: async (calendarIds, correlationIdByCalendarId) => {
      const result = await ingestOAuthSources(calendarIds, correlationIdByCalendarId);
      const { abortedCalendarIds, affectedUserIds } = result;
      if (abortedCalendarIds.length > 0 && affectedUserIds.length === 0) {
        throw new IngestBaselineMovedAbortError(abortedCalendarIds);
      }
      return { affectedUserIds };
    },
    now: () => new Date(),
    observe: (fields) => {
      widelog.setFields(fields);
    },
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    recordFailures: async (calendarIds) => {
      const counts = await Promise.all(calendarIds.map((calendarId) =>
        refreshLockRedis.hincrby(PENDING_FAILURES_KEY, calendarId, 1)));
      await releaseClaimedCalendars(refreshLockRedis, calendarIds);
      return Object.fromEntries(
        calendarIds.map((calendarId, index) => [calendarId, counts[index] ?? 0]),
      );
    },
    releaseAbandoned: async (calendarIds) => {
      await refreshLockRedis.zrem(PENDING_INGEST_KEY, ...calendarIds);
      await refreshLockRedis.hdel(PENDING_FAILURES_KEY, ...calendarIds);
      await refreshLockRedis.hdel(PENDING_CORRELATION_KEY, ...calendarIds);
      await refreshLockRedis.hdel(PENDING_REWAKE_KEY, ...calendarIds);
    },
    releaseClaims: (calendarIds) =>
      releaseClaimedCalendars(refreshLockRedis, calendarIds),
    releasePending: async (members) => {
      const removed = await releaseUnchangedMembers(refreshLockRedis, members);
      await releaseClaimedCalendars(
        refreshLockRedis,
        members.map((member) => member.calendarId),
      );
      return removed;
    },
    resolveCalendars: (calendarIds) => database
      .select({ calendarId: calendarsTable.id, userId: calendarsTable.userId })
      .from(calendarsTable)
      .where(and(
        inArray(calendarsTable.id, calendarIds),
        eq(calendarsTable.disabled, false),
        arrayContains(calendarsTable.capabilities, ["pull"]),
      )),
    resolvePlan: (userId) => premiumService.getUserPlan(userId),
  };
};

/*
 * Overrun protection suppresses a tick without invoking the callback, so a lost tick
 * emits no event at all. The gap on the next surviving tick is the only positive
 * evidence that ticks were eaten; ticks_skipped is round(gap / 10s) - 1.
 *
 * It has to be start-to-start. Measuring from the previous tick's completion would
 * report the scheduler's idle time — about 10s no matter how long the suppressing
 * tick ran — and so read "nothing was skipped" during exactly the overrun it exists
 * to expose. It is stamped before the drain lock is contested so a tick that loses
 * the lock still anchors the next gap, and it is per process while the lock is
 * cross-replica, so read it grouped by instance.
 */
let lastTickStartedAt: number | null = null;

const observedDrain = withCronWideEvent({
  async callback() {
    const tickStartedAt = Date.now();
    if (lastTickStartedAt !== null) {
      widelog.set("push_drain.tick_gap_ms", tickStartedAt - lastTickStartedAt);
    }
    lastTickStartedAt = tickStartedAt;
    const { refreshLockRedis: heartbeatRedis } = await import("@/context");
    const signalReader = await describeSignalReader(heartbeatRedis);
    widelog.set("push_drain.signal_reader_running", signalReader.running);
    widelog.set("push_drain.signal_reads", signalReader.reads);
    const dependencies = await createDefaultDependencies();

    const { refreshLockStore } = await import("@/context");
    if (!await refreshLockStore.tryAcquire(DRAIN_LOCK_KEY, DRAIN_LOCK_TTL_SECONDS)) {
      widelog.set("push_drain.lock_contention", 1);
      return;
    }

    const { inFlightDrainRegistry } = await import("@/context");
    const tick = drainWithLockRelease(
      dependencies,
      () => refreshLockStore.release(DRAIN_LOCK_KEY),
    );
    inFlightDrainRegistry.register(tick);
    await tick;
  },
  cron: "*/10 * * * * *",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;

export { createDefaultDependencies };

export default {
  ...observedDrain,
  async callback() {
    const { default: environment } = await import("@/env");
    if (!environment.WEBHOOK_PUBLIC_URL) {
      return;
    }
    await observedDrain.callback();
  },
} satisfies CronOptions;
