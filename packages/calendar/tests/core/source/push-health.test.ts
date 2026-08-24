import { describe, expect, it } from "vitest";
import {
  FULL_POLL_INTERVAL_MS,
  PUSH_HEALTHY_POLL_FLOOR_MS,
  resolveIngestPollFloorMs,
  resolvePushChannelHealth,
  type PushChannelState,
  type StoredPushChannel,
} from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

const makeHealthyChannel = (
  overrides: Partial<StoredPushChannel> = {},
): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: new Date(NOW.getTime() - 24 * HOUR_MS),
  expiresAt: new Date(NOW.getTime() + 6 * 24 * HOUR_MS),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: new Date(NOW.getTime() - HOUR_MS),
  nextAttemptAt: null,
  provider: "google",
  providerChannelId: "provider-channel-1",
  providerResourceId: "provider-resource-1",
  reauthorizeRequestedAt: null,
  resourcePath: "/calendars/external-1/events",
  secretHash: "a".repeat(64),
  state: "active",
  updatedAt: NOW,
  userId: "user-1",
  verifiedAt: new Date(NOW.getTime() - 12 * HOUR_MS),
  ...overrides,
});

const floorFor = (
  channel: StoredPushChannel | null,
  overrides: { needsReauthentication?: boolean; plan?: "free" | "pro" } = {},
): number => resolveIngestPollFloorMs({
  channel,
  needsReauthentication: overrides.needsReauthentication ?? false,
  now: NOW,
  plan: overrides.plan ?? "pro",
});

describe("resolvePushChannelHealth", () => {
  it("reports a fully verified active Google channel as healthy", () => {
    expect(resolvePushChannelHealth(makeHealthyChannel(), NOW).healthy).toBe(true);
  });

  it("never reports a registering row as healthy even without an expiry", () => {
    const registering = makeHealthyChannel({
      expiresAt: null,
      state: "registering",
      verifiedAt: null,
    });
    expect(resolvePushChannelHealth(registering, NOW).healthy).toBe(false);
  });

  it("never reports an active row without a provider expiry as healthy", () => {
    expect(resolvePushChannelHealth(makeHealthyChannel({ expiresAt: null }), NOW).healthy)
      .toBe(false);
  });

  it("never reports an unverified row as healthy", () => {
    expect(resolvePushChannelHealth(makeHealthyChannel({ verifiedAt: null }), NOW).healthy)
      .toBe(false);
  });
});

describe("resolveIngestPollFloorMs", () => {
  it("falls back to the full poll interval when there is no channel", () => {
    expect(floorFor(null)).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back for a registering row with a null expiry", () => {
    expect(floorFor(makeHealthyChannel({
      expiresAt: null,
      state: "registering",
      verifiedAt: null,
    }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back when registration succeeded but nothing was ever delivered", () => {
    expect(floorFor(makeHealthyChannel({ verifiedAt: null }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back when an active row has no provider expiry", () => {
    expect(floorFor(makeHealthyChannel({ expiresAt: null }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back once the expiry is inside the renewal lead", () => {
    expect(floorFor(makeHealthyChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
    }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back once the expiry is in the past", () => {
    expect(floorFor(makeHealthyChannel({
      expiresAt: new Date(NOW.getTime() - HOUR_MS),
    }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back when the last notification is older than a day", () => {
    expect(floorFor(makeHealthyChannel({
      lastNotificationAt: new Date(NOW.getTime() - 25 * HOUR_MS),
    }))).toBe(FULL_POLL_INTERVAL_MS);
    expect(floorFor(makeHealthyChannel({ lastNotificationAt: null })))
      .toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back when the owning account needs reauthentication", () => {
    expect(floorFor(makeHealthyChannel(), { needsReauthentication: true }))
      .toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back for a free plan", () => {
    expect(floorFor(makeHealthyChannel(), { plan: "free" })).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back for Outlook even when the channel is otherwise healthy", () => {
    expect(floorFor(makeHealthyChannel({
      provider: "outlook",
      providerResourceId: null,
    }))).toBe(FULL_POLL_INTERVAL_MS);
  });

  it("falls back for every non-active state", () => {
    const states: PushChannelState[] = ["degraded", "failed", "registering", "removed"];
    for (const state of states) {
      expect(floorFor(makeHealthyChannel({ state }))).toBe(FULL_POLL_INTERVAL_MS);
    }
  });

  it("relaxes only a fully healthy pro Google channel, and only to a finite floor", () => {
    const relaxed = floorFor(makeHealthyChannel());
    expect(relaxed).toBe(PUSH_HEALTHY_POLL_FLOOR_MS);
    expect(relaxed).toBeGreaterThanOrEqual(300_000);
    expect(relaxed).toBeLessThanOrEqual(FULL_POLL_INTERVAL_MS * 15);
  });

  it("never returns zero, negative, infinite or NaN across the whole input space", () => {
    const states: PushChannelState[] = [
      "active",
      "degraded",
      "failed",
      "registering",
      "removed",
    ];
    const expiries = [null, new Date(NOW.getTime() - HOUR_MS), new Date(NOW.getTime() + 6 * 24 * HOUR_MS)];
    const verifications = [null, new Date(NOW.getTime() - 12 * HOUR_MS)];
    const notifications = [null, new Date(NOW.getTime() - 25 * HOUR_MS), new Date(NOW.getTime() - HOUR_MS)];
    const providers = ["google", "outlook", "caldav"];
    const plans = ["free", "pro"] as const;

    const cases = states.flatMap((state) => expiries.flatMap((expiresAt) =>
      verifications.flatMap((verifiedAt) => notifications.flatMap((lastNotificationAt) =>
        providers.flatMap((provider) => plans.flatMap((plan) =>
          [false, true].map((needsReauthentication) => ({
            channel: makeHealthyChannel({
              expiresAt,
              lastNotificationAt,
              provider,
              state,
              verifiedAt,
            }),
            needsReauthentication,
            plan,
          })),
        )),
      )),
    ));

    const observed = new Set<number>();
    for (const testCase of cases) {
      const floor = floorFor(testCase.channel, {
        needsReauthentication: testCase.needsReauthentication,
        plan: testCase.plan,
      });
      expect(Number.isFinite(floor)).toBe(true);
      expect(floor).toBeGreaterThan(0);
      observed.add(floor);
    }

    expect([...observed].toSorted((left, right) => left - right))
      .toEqual([FULL_POLL_INTERVAL_MS, PUSH_HEALTHY_POLL_FLOOR_MS]
        .toSorted((left, right) => left - right));
  });
});
