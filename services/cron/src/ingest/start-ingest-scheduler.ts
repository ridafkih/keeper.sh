import {
  LIVE_PUSH_CHANNEL_STATES,
  toPushChannelState,
} from "@keeper.sh/calendar";
import type { StoredPushChannel } from "@keeper.sh/calendar";
import {
  claimIngests,
  completeIngests,
  releaseIngests,
} from "@keeper.sh/database";
import type { ClaimedIngest, IngestScheduleLane } from "@keeper.sh/database";
import {
  apiTokensTable,
  calendarAccountsTable,
  calendarPushChannelsTable,
  calendarsTable,
  icalFeedCalendarsTable,
  sourceDestinationMappingsTable,
  userSyncRequestsTable,
} from "@keeper.sh/database/schema";
import { oauthAccessToken, session } from "@keeper.sh/database/auth-schema";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import { database, premiumService } from "@/context";
import { enqueueDestinationSyncsForUsers } from "@/utils/enqueue-destination-syncs";
import { fleetIngestLane, pushIngestLane } from "@/utils/ingest-lanes";
import type { IngestLane as IngestResources } from "@/utils/ingest-lanes";
import { context, widelog } from "@/utils/logging";
import { withWideEvent } from "@/utils/with-wide-event";
import type { IngestDials, IngestLaneDials } from "./ingest-dials";
import { startIngestLane } from "./ingest-lane";
import type { IngestLane } from "./ingest-lane";
import { ingestSourceCalendars } from "./ingest-sources";
import { runIngestRound } from "./run-ingest-round";
import type { IngestRoundDependencies } from "./run-ingest-round";
import { resolveScheduleContexts } from "./schedule-context";
import type { ScheduleContextDependencies, ScheduledCalendar } from "./schedule-context";

interface IngestScheduler {
  stop: (deadlineMs: number) => Promise<void>;
}

const readScheduledCalendars = async (calendarIds: string[]): Promise<ScheduledCalendar[]> => {
  const rows = await database
    .select({
      calendarId: calendarsTable.id,
      feedsDestination: sql<boolean>`exists (
        select 1 from ${sourceDestinationMappingsTable}
        where ${sourceDestinationMappingsTable.sourceCalendarId} = ${calendarsTable.id}
      )`,
      needsReauthentication: calendarAccountsTable.needsReauthentication,
      published: sql<boolean>`${calendarsTable.includeInIcalFeed} or exists (
        select 1 from ${icalFeedCalendarsTable}
        where ${icalFeedCalendarsTable.calendarId} = ${calendarsTable.id}
      )`,
      userId: calendarsTable.userId,
    })
    .from(calendarsTable)
    .innerJoin(calendarAccountsTable, eq(calendarsTable.accountId, calendarAccountsTable.id))
    .where(inArray(calendarsTable.id, calendarIds));
  return rows.map((row) => ({
    ...row,
    feedsDestination: Boolean(row.feedsDestination),
    published: Boolean(row.published),
  }));
};

const readLiveChannels = async (calendarIds: string[]): Promise<StoredPushChannel[]> => {
  const rows = await database
    .select()
    .from(calendarPushChannelsTable)
    .where(and(
      inArray(calendarPushChannelsTable.calendarId, calendarIds),
      inArray(calendarPushChannelsTable.state, [...LIVE_PUSH_CHANNEL_STATES]),
    ));
  return rows.map((row) => ({ ...row, state: toPushChannelState(row.state) }));
};

const toTimestamp = (value: Date | string | null): number | null => {
  if (value === null) {
    return null;
  }
  return new Date(value).getTime();
};

const mergeLatest = (
  latest: Map<string, Date>,
  rows: { at: Date | string | null; userId: string | null }[],
): void => {
  for (const row of rows) {
    const at = toTimestamp(row.at);
    if (row.userId === null || at === null) {
      continue;
    }
    const current = latest.get(row.userId);
    if (!current || current.getTime() < at) {
      latest.set(row.userId, new Date(at));
    }
  }
};

const readLastActiveAt = async (userIds: string[]): Promise<Map<string, Date>> => {
  const [sessions, tokens, mcpTokens] = await Promise.all([
    database
      .select({ at: max(session.updatedAt), userId: session.userId })
      .from(session)
      .where(inArray(session.userId, userIds))
      .groupBy(session.userId),
    database
      .select({ at: max(apiTokensTable.lastUsedAt), userId: apiTokensTable.userId })
      .from(apiTokensTable)
      .where(inArray(apiTokensTable.userId, userIds))
      .groupBy(apiTokensTable.userId),
    database
      .select({ at: max(oauthAccessToken.createdAt), userId: oauthAccessToken.userId })
      .from(oauthAccessToken)
      .where(inArray(oauthAccessToken.userId, userIds))
      .groupBy(oauthAccessToken.userId),
  ]);
  const latest = new Map<string, Date>();
  mergeLatest(latest, sessions);
  mergeLatest(latest, tokens);
  mergeLatest(latest, mcpTokens);
  return latest;
};

const recordFirstIngestSyncRequests = async (userIds: string[]): Promise<void> => {
  const settlements = await Promise.allSettled(userIds.map((userId) => {
    const request = { requestId: crypto.randomUUID(), requestedAt: new Date() };
    return database
      .insert(userSyncRequestsTable)
      .values({ ...request, userId })
      .onConflictDoUpdate({ target: userSyncRequestsTable.userId, set: request });
  }));
  const failures = settlements
    .filter((settlement): settlement is PromiseRejectedResult => settlement.status === "rejected")
    .map(({ reason }) => reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "First ingest sync requests could not be recorded");
  }
};

const createScheduleContextDependencies = (dials: IngestDials): ScheduleContextDependencies => ({
  dormantAfterMs: dials.dormantAfterMs,
  now: () => new Date(),
  readCalendars: readScheduledCalendars,
  readChannels: readLiveChannels,
  readLastActiveAt,
  resolvePlan: (userId) => premiumService.getUserPlan(userId),
});

const createRoundDependencies = (
  dials: IngestDials,
  resources: IngestResources,
): IngestRoundDependencies => {
  const scheduleContextDependencies = createScheduleContextDependencies(dials);
  return {
    completeIngests: (completions) => completeIngests(database, completions),
    dials: dials.intervals,
    enqueueDestinationSyncs: async (userIds, trigger, correlationIdByUserId, webhookReceivedAtByUserId) => {
      await enqueueDestinationSyncsForUsers(
        userIds,
        trigger,
        correlationIdByUserId,
        webhookReceivedAtByUserId,
      );
    },
    ingestCalendars: ingestSourceCalendars,
    observe: (fields) => {
      widelog.setFields(fields);
    },
    random: Math.random,
    recordError: (error, slug) => {
      widelog.errorFields(error, { retriable: true, slug });
    },
    recordFirstIngestSyncRequests,
    resolveScheduleContexts: (calendarIds) =>
      resolveScheduleContexts(calendarIds, scheduleContextDependencies),
    resources,
  };
};

const reportLaneError = (lane: IngestScheduleLane, error: unknown, phase: string): void => {
  context(() => {
    widelog.set("operation.name", "ingest-lane");
    widelog.set("operation.type", "job");
    widelog.set("schedule.lane", lane);
    widelog.set("schedule.phase", phase);
    widelog.set("outcome", "error");
    widelog.errorFields(error, { retriable: true, slug: `ingest-${phase}-failed` });
    widelog.flush();
  });
};

const startScheduledLane = (
  lane: IngestScheduleLane,
  laneDials: IngestLaneDials,
  dials: IngestDials,
  resources: IngestResources,
): IngestLane<ClaimedIngest> => {
  const dependencies = createRoundDependencies(dials, resources);
  return startIngestLane<ClaimedIngest>({
    ...laneDials,
    claim: (limit) => claimIngests(database, {
      lane,
      leaseMs: dials.leaseMs,
      leaseToken: crypto.randomUUID(),
      limit,
    }),
    onError: (error, phase) => {
      reportLaneError(lane, error, phase);
    },
    runRound: (claims) => withWideEvent({
      name: "ingest-round",
      onError: (error) => {
        widelog.errorFields(error, { retriable: true, slug: "ingest-round-failed" });
      },
      run: () => runIngestRound(lane, claims, dependencies),
    }),
  });
};

const settleWithin = async (work: Promise<unknown>, deadlineMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
  });
  try {
    await Promise.race([work, deadline]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const startIngestScheduler = (dials: IngestDials): IngestScheduler => {
  const lanes = [
    startScheduledLane("wake", dials.wake, dials, pushIngestLane),
    startScheduledLane("fleet", dials.fleet, dials, fleetIngestLane),
  ];
  return {
    stop: async (deadlineMs) => {
      await settleWithin(Promise.all(lanes.map((lane) => lane.stop())), deadlineMs);
      const unfinished = lanes.flatMap((lane) => lane.pendingClaims());
      if (unfinished.length > 0) {
        await releaseIngests(database, unfinished).catch((error: unknown) => {
          reportLaneError("fleet", error, "release");
        });
      }
    },
  };
};

export { startIngestScheduler };
export type { IngestScheduler };
