import { describe, expect, it } from "vitest";
import type { IngestPlan, StoredPushChannel } from "@keeper.sh/calendar";
import { resolveScheduleContexts } from "../../src/ingest/schedule-context";
import type { ScheduleContextDependencies, ScheduledCalendar } from "../../src/ingest/schedule-context";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const calendar = (overrides: Partial<ScheduledCalendar> = {}): ScheduledCalendar => ({
  calendarId: "calendar-1",
  feedsDestination: true,
  needsReauthentication: false,
  published: false,
  userId: "user-1",
  ...overrides,
});

const healthyChannel = (calendarId: string): StoredPushChannel => ({
  accountId: "account-1",
  calendarId,
  createdAt: new Date(NOW.getTime() - DAY_MS),
  expiresAt: new Date(NOW.getTime() + 6 * DAY_MS),
  failureCount: 0,
  id: `channel-${calendarId}`,
  lastFailureAt: null,
  lastNotificationAt: new Date(NOW.getTime() - HOUR_MS),
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: `provider-${calendarId}`,
  providerResourceId: `resource-${calendarId}`,
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: new Date(NOW.getTime() - 12 * HOUR_MS),
});

interface DependencyOverrides {
  calendars?: ScheduledCalendar[];
  channels?: StoredPushChannel[];
  dormantAfterMs?: number | null;
  lastActiveAt?: Map<string, Date>;
  plans?: Record<string, IngestPlan | Error>;
}

const resolveDormantAfterMs = (overrides: DependencyOverrides): number | null => {
  if (overrides.dormantAfterMs === null) {
    return null;
  }
  return overrides.dormantAfterMs ?? 30 * DAY_MS;
};

const dependenciesFor = (overrides: DependencyOverrides = {}) => {
  const activityLookups: string[][] = [];
  const dependencies: ScheduleContextDependencies = {
    dormantAfterMs: resolveDormantAfterMs(overrides),
    now: () => NOW,
    readCalendars: () => Promise.resolve(overrides.calendars ?? [calendar()]),
    readChannels: () => Promise.resolve(overrides.channels ?? []),
    readLastActiveAt: (userIds) => {
      activityLookups.push(userIds);
      return Promise.resolve(overrides.lastActiveAt ?? new Map());
    },
    resolvePlan: (userId) => {
      const plan = overrides.plans?.[userId] ?? "free";
      if (plan instanceof Error) {
        return Promise.reject(plan);
      }
      return Promise.resolve(plan);
    },
  };
  return { activityLookups, dependencies };
};

describe("resolveScheduleContexts", () => {
  it("reads each owner's plan", async () => {
    const { dependencies } = dependenciesFor({
      calendars: [
        calendar({ calendarId: "calendar-free", userId: "user-free" }),
        calendar({ calendarId: "calendar-pro", userId: "user-pro" }),
      ],
      plans: { "user-free": "free", "user-pro": "pro" },
    });

    const contexts = await resolveScheduleContexts(["calendar-free", "calendar-pro"], dependencies);

    expect(contexts.get("calendar-free")?.plan).toBe("free");
    expect(contexts.get("calendar-pro")?.plan).toBe("pro");
  });

  it("assumes pro when a plan cannot be read, so a paying user is never polled slower", async () => {
    const { dependencies } = dependenciesFor({
      plans: { "user-1": new Error("database unavailable") },
    });

    const contexts = await resolveScheduleContexts(["calendar-1"], dependencies);

    expect(contexts.get("calendar-1")?.plan).toBe("pro");
  });

  it("treats only a healthy Google channel on a healthy account as push-healthy", async () => {
    const { dependencies } = dependenciesFor({
      calendars: [
        calendar({ calendarId: "calendar-push" }),
        calendar({ calendarId: "calendar-reauth", needsReauthentication: true }),
        calendar({ calendarId: "calendar-poll" }),
      ],
      channels: [healthyChannel("calendar-push"), healthyChannel("calendar-reauth")],
    });

    const contexts = await resolveScheduleContexts(
      ["calendar-push", "calendar-reauth", "calendar-poll"],
      dependencies,
    );

    expect(contexts.get("calendar-push")?.pushHealthy).toBe(true);
    expect(contexts.get("calendar-reauth")?.pushHealthy).toBe(false);
    expect(contexts.get("calendar-poll")?.pushHealthy).toBe(false);
  });

  it("marks an unmapped, unpublished calendar of an inactive owner dormant", async () => {
    const { dependencies } = dependenciesFor({
      calendars: [calendar({ feedsDestination: false })],
      lastActiveAt: new Map([["user-1", new Date(NOW.getTime() - 45 * DAY_MS)]]),
    });

    const contexts = await resolveScheduleContexts(["calendar-1"], dependencies);

    expect(contexts.get("calendar-1")?.dormant).toBe(true);
  });

  it("treats an owner with no recorded activity as inactive", async () => {
    const { dependencies } = dependenciesFor({
      calendars: [calendar({ feedsDestination: false })],
    });

    const contexts = await resolveScheduleContexts(["calendar-1"], dependencies);

    expect(contexts.get("calendar-1")?.dormant).toBe(true);
  });

  it("never marks a calendar dormant while its owner is active", async () => {
    const { dependencies } = dependenciesFor({
      calendars: [calendar({ feedsDestination: false })],
      lastActiveAt: new Map([["user-1", new Date(NOW.getTime() - 2 * DAY_MS)]]),
    });

    const contexts = await resolveScheduleContexts(["calendar-1"], dependencies);

    expect(contexts.get("calendar-1")?.dormant).toBe(false);
  });

  it("never marks a calendar dormant while it feeds a destination or a published feed", async () => {
    const { activityLookups, dependencies } = dependenciesFor({
      calendars: [
        calendar({ calendarId: "calendar-mapped", feedsDestination: true }),
        calendar({ calendarId: "calendar-published", feedsDestination: false, published: true }),
      ],
    });

    const contexts = await resolveScheduleContexts(
      ["calendar-mapped", "calendar-published"],
      dependencies,
    );

    expect(contexts.get("calendar-mapped")?.dormant).toBe(false);
    expect(contexts.get("calendar-published")?.dormant).toBe(false);
    expect(activityLookups).toEqual([]);
  });

  it("skips the activity lookup entirely when dormancy is turned off", async () => {
    const { activityLookups, dependencies } = dependenciesFor({
      calendars: [calendar({ feedsDestination: false })],
      dormantAfterMs: null,
    });

    const contexts = await resolveScheduleContexts(["calendar-1"], dependencies);

    expect(contexts.get("calendar-1")?.dormant).toBe(false);
    expect(activityLookups).toEqual([]);
  });

  it("reads nothing for an empty claim", async () => {
    const { activityLookups, dependencies } = dependenciesFor();

    expect(await resolveScheduleContexts([], dependencies)).toEqual(new Map());
    expect(activityLookups).toEqual([]);
  });
});
