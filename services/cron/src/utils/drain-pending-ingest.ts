import type { Plan } from "@keeper.sh/data-schemas";

const MAX_DRAIN_BATCH = 50;
const MAX_PENDING_FAILURES = 5;
const DRAIN_BATCH_FAILED_SLUG = "push-drain-batch-failed";

interface PendingIngestMember {
  calendarId: string;
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
  enqueueDestinationSyncs: (userIds: string[]) => Promise<void>;
  ingestCalendars: (calendarIds: string[]) => Promise<{ affectedUserIds: string[] }>;
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

  const eligibleIds = eligible.map((member) => member.calendarId);

  let affectedUserIds: string[] = [];
  try {
    ({ affectedUserIds } = await dependencies.ingestCalendars(eligibleIds));
  } catch (error) {
    dependencies.recordError(error, DRAIN_BATCH_FAILED_SLUG);
    const abandonedBatchCount = await abandonExhaustedMembers(eligibleIds, dependencies);
    dependencies.observe({
      "push_drain.abandoned": abandonedBlockedCount + abandonedBatchCount,
    });
    return 0;
  }

  const released = await dependencies.releasePending(eligible);
  dependencies.observe({
    "push_drain.abandoned": abandonedBlockedCount,
    "push_drain.affected_user_count": affectedUserIds.length,
    "push_drain.retained_count": eligible.length - released.length,
  });

  await dependencies.enqueueDestinationSyncs(affectedUserIds);

  return eligible.length;
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
