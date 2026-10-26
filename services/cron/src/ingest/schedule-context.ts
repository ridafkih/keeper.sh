import type { IngestPlan, StoredPushChannel } from "@keeper.sh/calendar";
import { isIngestPushHealthy } from "@keeper.sh/calendar";

interface IngestScheduleContext {
  dormant: boolean;
  plan: IngestPlan;
  pushHealthy: boolean;
}

interface ScheduledCalendar {
  calendarId: string;
  feedsDestination: boolean;
  needsReauthentication: boolean;
  published: boolean;
  userId: string;
}

interface ScheduleContextDependencies {
  dormantAfterMs: number | null;
  now: () => Date;
  readCalendars: (calendarIds: string[]) => Promise<ScheduledCalendar[]>;
  readChannels: (calendarIds: string[]) => Promise<StoredPushChannel[]>;
  readLastActiveAt: (userIds: string[]) => Promise<Map<string, Date>>;
  resolvePlan: (userId: string) => Promise<IngestPlan>;
}

const DEFAULT_SCHEDULE_CONTEXT: IngestScheduleContext = {
  dormant: false,
  plan: "pro",
  pushHealthy: false,
};

const resolvePlans = async (
  userIds: string[],
  resolvePlan: (userId: string) => Promise<IngestPlan>,
): Promise<Map<string, IngestPlan>> => {
  const settlements = await Promise.allSettled(userIds.map((userId) => resolvePlan(userId)));
  return new Map(userIds.map((userId, index): [string, IngestPlan] => {
    const settlement = settlements[index];
    if (settlement?.status === "fulfilled") {
      return [userId, settlement.value];
    }
    return [userId, "pro"];
  }));
};

const isDormantCandidate = (calendar: ScheduledCalendar): boolean =>
  !calendar.feedsDestination && !calendar.published;

const resolveDormantUserIds = async (
  calendars: ScheduledCalendar[],
  dependencies: ScheduleContextDependencies,
): Promise<Set<string>> => {
  const { dormantAfterMs } = dependencies;
  if (dormantAfterMs === null) {
    return new Set();
  }
  const candidateUserIds = [...new Set(
    calendars.filter((calendar) => isDormantCandidate(calendar)).map(({ userId }) => userId),
  )];
  if (candidateUserIds.length === 0) {
    return new Set();
  }
  const lastActiveAtByUserId = await dependencies.readLastActiveAt(candidateUserIds);
  const activeSince = dependencies.now().getTime() - dormantAfterMs;
  return new Set(candidateUserIds.filter((userId) => {
    const lastActiveAt = lastActiveAtByUserId.get(userId);
    return !lastActiveAt || lastActiveAt.getTime() < activeSince;
  }));
};

const resolveScheduleContexts = async (
  calendarIds: string[],
  dependencies: ScheduleContextDependencies,
): Promise<Map<string, IngestScheduleContext>> => {
  if (calendarIds.length === 0) {
    return new Map();
  }
  const [calendars, channels] = await Promise.all([
    dependencies.readCalendars(calendarIds),
    dependencies.readChannels(calendarIds),
  ]);
  const [plans, dormantUserIds] = await Promise.all([
    resolvePlans([...new Set(calendars.map(({ userId }) => userId))], dependencies.resolvePlan),
    resolveDormantUserIds(calendars, dependencies),
  ]);
  const channelByCalendarId = new Map(channels.flatMap((channel): [string, StoredPushChannel][] => {
    if (channel.calendarId === null) {
      return [];
    }
    return [[channel.calendarId, channel]];
  }));
  const now = dependencies.now();
  return new Map(calendars.map((calendar): [string, IngestScheduleContext] => [
    calendar.calendarId,
    {
      dormant: isDormantCandidate(calendar) && dormantUserIds.has(calendar.userId),
      plan: plans.get(calendar.userId) ?? "pro",
      pushHealthy: isIngestPushHealthy({
        channel: channelByCalendarId.get(calendar.calendarId) ?? null,
        needsReauthentication: calendar.needsReauthentication,
        now,
      }),
    },
  ]));
};

export { DEFAULT_SCHEDULE_CONTEXT, resolveScheduleContexts };
export type { IngestScheduleContext, ScheduleContextDependencies, ScheduledCalendar };
