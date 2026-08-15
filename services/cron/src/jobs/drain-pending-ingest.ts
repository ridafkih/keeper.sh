import type { CronOptions } from "cronbake";
import { withCronWideEvent } from "@/utils/with-wide-event";
import { widelog } from "@/utils/logging";
import {
  runDrainPendingIngest,
  type DrainPendingIngestDependencies,
  type PendingIngestMember,
} from "@/utils/drain-pending-ingest";
import {
  PENDING_FAILURES_KEY,
  PENDING_INGEST_KEY,
  releaseUnchangedMembers,
} from "@/utils/pending-ingest-release";

const DRAIN_LOCK_KEY = "push-drain:tick";
const DRAIN_LOCK_TTL_SECONDS = 60;
const SCORE_STRIDE = 2;

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
    claimPending: async (limit) => parsePendingMembers(
      await refreshLockRedis.zrange(PENDING_INGEST_KEY, 0, limit - 1, "WITHSCORES"),
    ),
    countPending: () => refreshLockRedis.zcard(PENDING_INGEST_KEY),
    enabled: Boolean(environment.WEBHOOK_PUBLIC_URL),
    enqueueDestinationSyncs: async (userIds) => {
      await enqueueDestinationSyncsForUsers(userIds, "push");
    },
    ingestCalendars: async (calendarIds) => {
      const result = await ingestOAuthSources(calendarIds);
      return { affectedUserIds: result.affectedUserIds };
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
      return Object.fromEntries(
        calendarIds.map((calendarId, index) => [calendarId, counts[index] ?? 0]),
      );
    },
    releaseAbandoned: async (calendarIds) => {
      await refreshLockRedis.zrem(PENDING_INGEST_KEY, ...calendarIds);
      await refreshLockRedis.hdel(PENDING_FAILURES_KEY, ...calendarIds);
    },
    releasePending: (members) => releaseUnchangedMembers(refreshLockRedis, members),
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
    const dependencies = await createDefaultDependencies();

    const { refreshLockStore } = await import("@/context");
    if (!await refreshLockStore.tryAcquire(DRAIN_LOCK_KEY, DRAIN_LOCK_TTL_SECONDS)) {
      widelog.set("push_drain.lock_contention", 1);
      return;
    }

    try {
      await runDrainPendingIngest(dependencies);
    } finally {
      await refreshLockStore.release(DRAIN_LOCK_KEY);
    }
  },
  cron: "*/10 * * * * *",
  name: import.meta.file,
  overrunProtection: true,
}) satisfies CronOptions;

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
