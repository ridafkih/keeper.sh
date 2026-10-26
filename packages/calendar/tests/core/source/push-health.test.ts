import { describe, expect, it } from "vitest";
import {
  isIngestPushHealthy,
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

const healthyFor = (
  channel: StoredPushChannel | null,
  overrides: { needsReauthentication?: boolean } = {},
): boolean => isIngestPushHealthy({
  channel,
  needsReauthentication: overrides.needsReauthentication ?? false,
  now: NOW,
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

describe("isIngestPushHealthy", () => {
  it("is unhealthy without a channel", () => {
    expect(healthyFor(null)).toBe(false);
  });

  it("is unhealthy for a registering row with a null expiry", () => {
    expect(healthyFor(makeHealthyChannel({
      expiresAt: null,
      state: "registering",
      verifiedAt: null,
    }))).toBe(false);
  });

  it("is unhealthy when registration succeeded but nothing was ever delivered", () => {
    expect(healthyFor(makeHealthyChannel({ verifiedAt: null }))).toBe(false);
  });

  it("is unhealthy when an active row has no provider expiry", () => {
    expect(healthyFor(makeHealthyChannel({ expiresAt: null }))).toBe(false);
  });

  it("is unhealthy once the expiry is inside the renewal lead or past", () => {
    expect(healthyFor(makeHealthyChannel({
      expiresAt: new Date(NOW.getTime() + HOUR_MS),
    }))).toBe(false);
    expect(healthyFor(makeHealthyChannel({
      expiresAt: new Date(NOW.getTime() - HOUR_MS),
    }))).toBe(false);
  });

  it("is unhealthy when the last notification is older than a day", () => {
    expect(healthyFor(makeHealthyChannel({
      lastNotificationAt: new Date(NOW.getTime() - 25 * HOUR_MS),
    }))).toBe(false);
    expect(healthyFor(makeHealthyChannel({ lastNotificationAt: null }))).toBe(false);
  });

  it("is unhealthy when the owning account needs reauthentication", () => {
    expect(healthyFor(makeHealthyChannel(), { needsReauthentication: true })).toBe(false);
  });

  it("is unhealthy for Outlook even when the channel is otherwise healthy", () => {
    expect(healthyFor(makeHealthyChannel({
      provider: "outlook",
      providerResourceId: null,
    }))).toBe(false);
  });

  it("is unhealthy for every non-active state", () => {
    const states: PushChannelState[] = ["degraded", "failed", "registering", "removed"];
    for (const state of states) {
      expect(healthyFor(makeHealthyChannel({ state }))).toBe(false);
    }
  });

  it("is healthy only for a fully healthy Google channel", () => {
    expect(healthyFor(makeHealthyChannel())).toBe(true);
  });
});
