import {
  resolveIngestIntervalMs,
  resolveIngestJitterMs,
  resolveIngestScheduleDecision,
} from "@keeper.sh/calendar";
import type { IngestIntervalDials, IngestOutcome } from "@keeper.sh/calendar";
import type { ClaimedIngest, IngestCompletion, IngestScheduleLane } from "@keeper.sh/database";
import type { PushSyncTrigger } from "@keeper.sh/queue";
import type { IngestLane } from "@/utils/ingest-lanes";
import type { IngestRunOptions, IngestionBatchResult, SourceCalendarsIngestion } from "./ingest-sources";
import { DEFAULT_SCHEDULE_CONTEXT } from "./schedule-context";
import type { IngestScheduleContext } from "./schedule-context";

interface IngestRoundDependencies {
  completeIngests: (completions: IngestCompletion[]) => Promise<string[]>;
  dials: IngestIntervalDials;
  enqueueDestinationSyncs: (
    userIds: string[],
    trigger: PushSyncTrigger,
    correlationIdByUserId: Record<string, string>,
    webhookReceivedAtByUserId: Record<string, number>,
  ) => Promise<void>;
  ingestCalendars: (calendarIds: string[], options: IngestRunOptions) => Promise<SourceCalendarsIngestion>;
  observe: (fields: Record<string, number | string>) => void;
  random: () => number;
  recordError: (error: unknown, slug: string) => void;
  recordFirstIngestSyncRequests: (userIds: string[]) => Promise<void>;
  resolveScheduleContexts: (calendarIds: string[]) => Promise<Map<string, IngestScheduleContext>>;
  resources: IngestLane;
}

const TRIGGER_BY_LANE: Record<IngestScheduleLane, PushSyncTrigger> = {
  fleet: "cron",
  wake: "push",
};

const UNREACHED_OUTCOME: IngestOutcome = { backoff: false, kind: "failed" };
const UNMATCHED_OUTCOME: IngestOutcome = { kind: "unresolvable" };

const groupClaims = (lane: IngestScheduleLane, claims: ClaimedIngest[]): ClaimedIngest[][] => {
  if (lane === "fleet") {
    return [claims];
  }
  const byUserId = Map.groupBy(claims, ({ userId }) => userId);
  return [...byUserId.values()];
};

const isEarlierWake = (candidate: ClaimedIngest, incumbent: ClaimedIngest | undefined): boolean => {
  if (!incumbent?.wakeReceivedAt) {
    return true;
  }
  return (candidate.wakeReceivedAt?.getTime() ?? Infinity) < incumbent.wakeReceivedAt.getTime();
};

const attributeWakesToUsers = (claims: ClaimedIngest[]): {
  correlationIdByUserId: Record<string, string>;
  webhookReceivedAtByUserId: Record<string, number>;
} => {
  const earliestByUserId = new Map<string, ClaimedIngest>();
  for (const claim of claims) {
    if (claim.wakeCorrelationId === null || claim.wakeReceivedAt === null) {
      continue;
    }
    if (isEarlierWake(claim, earliestByUserId.get(claim.userId))) {
      earliestByUserId.set(claim.userId, claim);
    }
  }
  const correlationIdByUserId: Record<string, string> = {};
  const webhookReceivedAtByUserId: Record<string, number> = {};
  for (const [userId, claim] of earliestByUserId) {
    if (claim.wakeCorrelationId !== null && claim.wakeReceivedAt !== null) {
      correlationIdByUserId[userId] = claim.wakeCorrelationId;
      webhookReceivedAtByUserId[userId] = claim.wakeReceivedAt.getTime();
    }
  }
  return { correlationIdByUserId, webhookReceivedAtByUserId };
};

const buildRunOptions = (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  resources: IngestLane,
): IngestRunOptions => ({
  claimByCalendarId: Object.fromEntries(claims.map((claim) => [
    claim.calendarId,
    { lagMs: claim.lagMs, lane, woken: claim.wakeCorrelationId !== null },
  ])),
  correlationIdByCalendarId: Object.fromEntries(claims.flatMap((claim): [string, string][] => {
    if (claim.wakeCorrelationId === null) {
      return [];
    }
    return [[claim.calendarId, claim.wakeCorrelationId]];
  })),
  lane: resources,
  trigger: TRIGGER_BY_LANE[lane],
});

const buildCompletion = (
  claim: ClaimedIngest,
  outcome: IngestOutcome,
  context: IngestScheduleContext,
  dependencies: IngestRoundDependencies,
): IngestCompletion => {
  const intervalMs = resolveIngestIntervalMs(context, dependencies.dials);
  const decision = resolveIngestScheduleDecision(outcome, {
    failureCount: claim.failureCount,
    intervalMs,
    jitterMs: resolveIngestJitterMs(intervalMs, dependencies.random),
  });
  return {
    ...decision,
    calendarId: claim.calendarId,
    claimedReleaseSeq: claim.releaseSeq,
    claimedWakeSeq: claim.wakeSeq,
    leaseToken: claim.leaseToken,
  };
};

const resolveFallbackOutcome = (ingestion: SourceCalendarsIngestion | null): IngestOutcome => {
  if (ingestion && ingestion.failures.length === 0) {
    return UNMATCHED_OUTCOME;
  }
  return UNREACHED_OUTCOME;
};

const resolveOutcomes = (
  claims: ClaimedIngest[],
  ingestion: SourceCalendarsIngestion | null,
): Map<string, IngestOutcome> => {
  const reported = new Map(
    (ingestion?.result.outcomes ?? []).map(({ calendarId, outcome }) => [calendarId, outcome]),
  );
  const fallback = resolveFallbackOutcome(ingestion);
  return new Map(claims.map(({ calendarId }) => [
    calendarId,
    reported.get(calendarId) ?? fallback,
  ]));
};

const ingestClaims = async (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  dependencies: IngestRoundDependencies,
): Promise<SourceCalendarsIngestion | null> => {
  try {
    const ingestion = await dependencies.ingestCalendars(
      claims.map(({ calendarId }) => calendarId),
      buildRunOptions(lane, claims, dependencies.resources),
    );
    for (const failure of ingestion.failures) {
      dependencies.recordError(failure, "ingest-round-failed");
    }
    return ingestion;
  } catch (error) {
    dependencies.recordError(error, "ingest-round-failed");
    return null;
  }
};

const writeCompletions = async (
  completions: IngestCompletion[],
  dependencies: IngestRoundDependencies,
): Promise<number> => {
  try {
    const written = await dependencies.completeIngests(completions);
    return written.length;
  } catch (error) {
    dependencies.recordError(error, "ingest-schedule-write-failed");
    return 0;
  }
};

const propagate = async (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  result: IngestionBatchResult,
  dependencies: IngestRoundDependencies,
): Promise<void> => {
  if (result.firstIngestUserIds.length > 0) {
    try {
      await dependencies.recordFirstIngestSyncRequests(result.firstIngestUserIds);
    } catch (error) {
      dependencies.recordError(error, "first-ingest-sync-request-failed");
    }
  }
  if (result.affectedUserIds.length === 0 && result.firstIngestUserIds.length === 0) {
    return;
  }
  const { correlationIdByUserId, webhookReceivedAtByUserId } = attributeWakesToUsers(claims);
  try {
    await dependencies.enqueueDestinationSyncs(
      [...new Set([...result.affectedUserIds, ...result.firstIngestUserIds])],
      TRIGGER_BY_LANE[lane],
      correlationIdByUserId,
      webhookReceivedAtByUserId,
    );
  } catch (error) {
    dependencies.recordError(error, "ingest-destination-enqueue-failed");
  }
};

interface IngestGroupSummary {
  outcomes: IngestOutcome[];
  written: number;
}

const runClaimGroup = async (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  contexts: Map<string, IngestScheduleContext>,
  dependencies: IngestRoundDependencies,
): Promise<IngestGroupSummary> => {
  const ingestion = await ingestClaims(lane, claims, dependencies);
  const outcomes = resolveOutcomes(claims, ingestion);
  const completions = claims.map((claim) => buildCompletion(
    claim,
    outcomes.get(claim.calendarId) ?? UNREACHED_OUTCOME,
    contexts.get(claim.calendarId) ?? DEFAULT_SCHEDULE_CONTEXT,
    dependencies,
  ));
  const written = await writeCompletions(completions, dependencies);
  if (ingestion) {
    await propagate(lane, claims, ingestion.result, dependencies);
  }
  return { outcomes: [...outcomes.values()], written };
};

const resolveContexts = async (
  claims: ClaimedIngest[],
  dependencies: IngestRoundDependencies,
): Promise<Map<string, IngestScheduleContext>> => {
  try {
    return await dependencies.resolveScheduleContexts(claims.map(({ calendarId }) => calendarId));
  } catch (error) {
    dependencies.recordError(error, "ingest-schedule-context-failed");
    return new Map();
  }
};

const percentile = (sorted: number[], share: number): number =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;

const observeRound = (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  summaries: IngestGroupSummary[],
  dependencies: IngestRoundDependencies,
): void => {
  const lags = claims.map(({ lagMs }) => lagMs).toSorted((left, right) => left - right);
  const fields: Record<string, number | string> = {
    "schedule.claimed_count": claims.length,
    "schedule.lag_ms_max": lags.at(-1) ?? 0,
    "schedule.lag_ms_p50": percentile(lags, 0.5),
    "schedule.lag_ms_p99": percentile(lags, 0.99),
    "schedule.lane": lane,
    "schedule.written_count": summaries.reduce((total, { written }) => total + written, 0),
  };
  for (const { outcomes } of summaries) {
    for (const outcome of outcomes) {
      const key = `schedule.outcome.${outcome.kind}`;
      fields[key] = Number(fields[key] ?? 0) + 1;
    }
  }
  dependencies.observe(fields);
};

const runIngestRound = async (
  lane: IngestScheduleLane,
  claims: ClaimedIngest[],
  dependencies: IngestRoundDependencies,
): Promise<void> => {
  if (claims.length === 0) {
    return;
  }
  const contexts = await resolveContexts(claims, dependencies);
  const summaries = await Promise.all(
    groupClaims(lane, claims).map((group) => runClaimGroup(lane, group, contexts, dependencies)),
  );
  observeRound(lane, claims, summaries, dependencies);
};

export { runIngestRound };
export type { IngestRoundDependencies };
