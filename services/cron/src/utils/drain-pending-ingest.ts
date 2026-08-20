import type { Plan } from "@keeper.sh/data-schemas";

const MAX_DRAIN_BATCH = 50;
const MAX_PENDING_FAILURES = 5;
const DRAIN_BATCH_FAILED_SLUG = "push-drain-batch-failed";

interface PendingIngestMember {
  calendarId: string;
  correlationId?: string;
  score: number;
}

interface ResolvedPendingCalendar {
  calendarId: string;
  userId: string;
}

interface DrainPendingIngestDependencies {
  claimPending: (limit: number) => Promise<PendingIngestMember[]>;
  countPending: () => Promise<number>;
  enabled: boolean;
  enqueueDestinationSyncs: (
    userIds: string[],
    correlationIdByUserId: Record<string, string>,
    webhookReceivedAtByUserId: Record<string, number>,
  ) => Promise<void>;
  ingestCalendars: (
    calendarIds: string[],
    correlationIdByCalendarId: Record<string, string>,
  ) => Promise<{ affectedUserIds: string[] }>;
  now: () => Date;
  observe: (fields: Record<string, unknown>) => void;
  recordError: (error: unknown, slug: string) => void;
  recordFailures: (calendarIds: string[]) => Promise<Record<string, number>>;
  releaseAbandoned: (calendarIds: string[]) => Promise<void>;
  releasePending: (members: PendingIngestMember[]) => Promise<string[]>;
  resolveCalendars: (calendarIds: string[]) => Promise<ResolvedPendingCalendar[]>;
  resolvePlan: (userId: string) => Promise<Plan>;
}

interface PlanPartition {
  errorUserCount: number;
  freeUserIds: Set<string>;
  proUserIds: Set<string>;
}

const resolveQueueAges = (
  members: PendingIngestMember[],
  nowMs: number,
): { max: number; median: number } => {
  const ages = members.map((member) => nowMs - member.score).toSorted(
    (left, right) => left - right,
  );
  const midpoint = Math.floor(ages.length / 2);
  return {
    max: ages.at(-1) ?? 0,
    median: ages[midpoint] ?? 0,
  };
};

const partitionByPlan = async (
  userIds: string[],
  resolvePlan: (userId: string) => Promise<Plan>,
): Promise<PlanPartition> => {
  const settlements = await Promise.allSettled(
    userIds.map(async (userId) => ({ plan: await resolvePlan(userId), userId })),
  );

  const freeUserIds = new Set<string>();
  const proUserIds = new Set<string>();
  let errorUserCount = 0;

  for (const settlement of settlements) {
    if (settlement.status === "rejected") {
      errorUserCount += 1;
      continue;
    }
    if (settlement.value.plan === "pro") {
      proUserIds.add(settlement.value.userId);
      continue;
    }
    freeUserIds.add(settlement.value.userId);
  }

  return { errorUserCount, freeUserIds, proUserIds };
};

const collectCorrelationIds = (
  members: PendingIngestMember[],
): Record<string, string> => {
  const correlationIdByCalendarId: Record<string, string> = {};
  for (const member of members) {
    const correlationId = member.correlationId ?? "";
    if (correlationId.length > 0) {
      correlationIdByCalendarId[member.calendarId] = correlationId;
    }
  }
  return correlationIdByCalendarId;
};

/*
 * A user can own several woken calendars, so the ids collide here. The earliest webhook
 * wins because it is the one whose propagation latency the destination write closes.
 * Ranked by score rather than by claim order, because a signalled drain claims in signal
 * arrival order; taking the first claimed would name a different webhook than the receipt
 * stamp travelling beside it.
 */
const attributeCorrelationIdsToUsers = (
  members: PendingIngestMember[],
  userIdByCalendarId: Map<string, string>,
  affectedUserIds: string[],
): Record<string, string> => {
  const wanted = new Set(affectedUserIds);
  const correlationIdByUserId: Record<string, string> = {};
  const scoreByUserId = new Map<string, number>();
  for (const member of members) {
    const userId = userIdByCalendarId.get(member.calendarId) ?? "";
    const correlationId = member.correlationId ?? "";
    if (!wanted.has(userId) || correlationId.length === 0) {
      continue;
    }
    const incumbent = scoreByUserId.get(userId) ?? Number.POSITIVE_INFINITY;
    if (incumbent <= member.score) {
      continue;
    }
    scoreByUserId.set(userId, member.score);
    correlationIdByUserId[userId] = correlationId;
  }
  return correlationIdByUserId;
};

/*
 * The score is the webhook receipt stamp the API zadded. A user with several woken
 * calendars reports the earliest of them: the metric answers what the worst-served
 * webhook waited, and the freshest score would hide exactly the lag it exists to show.
 * Taken by score rather than by claim order, because a signalled drain claims in signal
 * arrival order rather than score order.
 */
const attributeWebhookReceiptToUsers = (
  members: PendingIngestMember[],
  userIdByCalendarId: Map<string, string>,
  affectedUserIds: string[],
): Record<string, number> => {
  const wanted = new Set(affectedUserIds);
  const webhookReceivedAtByUserId: Record<string, number> = {};
  for (const member of members) {
    const userId = userIdByCalendarId.get(member.calendarId) ?? "";
    if (!wanted.has(userId)) {
      continue;
    }
    const earliest = webhookReceivedAtByUserId[userId] ?? member.score;
    webhookReceivedAtByUserId[userId] = Math.min(earliest, member.score);
  }
  return webhookReceivedAtByUserId;
};

const abandonExhaustedMembers = async (
  calendarIds: string[],
  dependencies: DrainPendingIngestDependencies,
): Promise<number> => {
  if (calendarIds.length === 0) {
    return 0;
  }

  const failureCounts = await dependencies.recordFailures(calendarIds);
  const abandoned = calendarIds.filter(
    (calendarId) => (failureCounts[calendarId] ?? 0) >= MAX_PENDING_FAILURES,
  );
  if (abandoned.length > 0) {
    await dependencies.releaseAbandoned(abandoned);
  }
  return abandoned.length;
};

const runDrainPendingIngest = async (
  dependencies: DrainPendingIngestDependencies,
): Promise<number> => {
  if (!dependencies.enabled) {
    return 0;
  }

  const pendingCount = await dependencies.countPending();
  dependencies.observe({ "push_drain.pending_count": pendingCount });

  const claimed = await dependencies.claimPending(MAX_DRAIN_BATCH);
  if (claimed.length === 0) {
    dependencies.observe({ "push_drain.batch_count": 0 });
    return 0;
  }

  const nowMs = dependencies.now().getTime();
  const queueAges = resolveQueueAges(claimed, nowMs);
  dependencies.observe({
    "push_drain.batch_count": claimed.length,
    "push_drain.queue_age_ms_max": queueAges.max,
    "push_drain.queue_age_ms_p50": queueAges.median,
  });

  const resolved = await dependencies.resolveCalendars(
    claimed.map((member) => member.calendarId),
  );
  const userIdByCalendarId = new Map(
    resolved.map((calendar) => [calendar.calendarId, calendar.userId]),
  );
  const plans = await partitionByPlan(
    [...new Set(resolved.map((calendar) => calendar.userId))],
    dependencies.resolvePlan,
  );

  const eligible: PendingIngestMember[] = [];
  const ineligible: PendingIngestMember[] = [];
  const blocked: PendingIngestMember[] = [];
  let unresolvedCount = 0;
  let skippedPlanCount = 0;

  for (const member of claimed) {
    const userId = userIdByCalendarId.get(member.calendarId) ?? "";
    if (userId.length === 0) {
      unresolvedCount += 1;
      ineligible.push(member);
      continue;
    }
    if (plans.freeUserIds.has(userId)) {
      skippedPlanCount += 1;
      ineligible.push(member);
      continue;
    }
    if (plans.proUserIds.has(userId)) {
      eligible.push(member);
      continue;
    }
    blocked.push(member);
  }

  dependencies.observe({
    "push_drain.blocked_count": blocked.length,
    "push_drain.plan_error_count": plans.errorUserCount,
    "push_drain.skipped_plan_count": skippedPlanCount,
    "push_drain.unresolved_count": unresolvedCount,
  });

  if (ineligible.length > 0) {
    await dependencies.releasePending(ineligible);
  }

  const abandonedBlockedCount = await abandonExhaustedMembers(
    blocked.map((member) => member.calendarId),
    dependencies,
  );

  if (eligible.length === 0) {
    dependencies.observe({ "push_drain.abandoned": abandonedBlockedCount });
    return 0;
  }

  const outstandingByUserId = new Map<string, number>();
  for (const member of eligible) {
    const userId = userIdByCalendarId.get(member.calendarId) ?? "";
    outstandingByUserId.set(userId, (outstandingByUserId.get(userId) ?? 0) + 1);
  }
  const awaitingUserIds = new Set<string>();

  const takeSyncableUserIds = (ownerId: string, affectedUserIds: string[]): string[] => {
    for (const userId of affectedUserIds) {
      awaitingUserIds.add(userId);
    }
    outstandingByUserId.set(ownerId, (outstandingByUserId.get(ownerId) ?? 1) - 1);
    const syncable = [...awaitingUserIds].filter(
      (userId) => (outstandingByUserId.get(userId) ?? 0) <= 0,
    );
    for (const userId of syncable) {
      awaitingUserIds.delete(userId);
    }
    return syncable;
  };

  /*
   * One calendar per ingest call so a member's destination write leaves as soon as ITS
   * ingest lands: a 29s sibling used to hold a 200ms calendar's sync for the whole batch.
   * The fan-out costs no extra concurrency because the push ingest lane's pool permits and
   * serial flush writer are process-wide, not per call.
   */
  const outcomes = await Promise.all(eligible.map(async (member) => {
    const ownerId = userIdByCalendarId.get(member.calendarId) ?? "";
    let affectedUserIds: string[] = [];
    let failedId = "";
    let releasedCount = 0;
    try {
      ({ affectedUserIds } = await dependencies.ingestCalendars(
        [member.calendarId],
        collectCorrelationIds([member]),
      ));
      const released = await dependencies.releasePending([member]);
      releasedCount = released.length;
    } catch (error) {
      dependencies.recordError(error, DRAIN_BATCH_FAILED_SLUG);
      failedId = member.calendarId;
    }

    // A failed member still settles its owner, or a sibling's sync would wait on it forever.
    const syncableUserIds = takeSyncableUserIds(ownerId, affectedUserIds);
    if (syncableUserIds.length > 0) {
      try {
        /*
         * Attribution scans the whole eligible set, not just this member: a user with an
         * untagged and a tagged calendar in the same batch would otherwise enqueue untagged
         * first, and BullMQ's dedupe on the deterministic job id drops the tagged retry.
         */
        await dependencies.enqueueDestinationSyncs(
          syncableUserIds,
          attributeCorrelationIdsToUsers(eligible, userIdByCalendarId, syncableUserIds),
          attributeWebhookReceiptToUsers(eligible, userIdByCalendarId, syncableUserIds),
        );
      } catch (error) {
        dependencies.recordError(error, DRAIN_BATCH_FAILED_SLUG);
        failedId = member.calendarId;
      }
    }
    return { affectedUserIds, failedId, releasedCount };
  }));

  const affectedUserIds = new Set<string>();
  const failedIds: string[] = [];
  let releasedCount = 0;
  for (const outcome of outcomes) {
    for (const userId of outcome.affectedUserIds) {
      affectedUserIds.add(userId);
    }
    if (outcome.failedId.length > 0) {
      failedIds.push(outcome.failedId);
    }
    releasedCount += outcome.releasedCount;
  }

  const abandonedBatchCount = await abandonExhaustedMembers(failedIds, dependencies);
  const ingestedCount = eligible.length - failedIds.length;
  dependencies.observe({
    "push_drain.abandoned": abandonedBlockedCount + abandonedBatchCount,
    "push_drain.affected_user_count": affectedUserIds.size,
    "push_drain.retained_count": ingestedCount - releasedCount,
  });

  return ingestedCount;
};

export {
  DRAIN_BATCH_FAILED_SLUG,
  MAX_DRAIN_BATCH,
  MAX_PENDING_FAILURES,
  runDrainPendingIngest,
};
export type {
  DrainPendingIngestDependencies,
  PendingIngestMember,
  ResolvedPendingCalendar,
};
