import { describe, expect, it, vi } from "vitest";
import {
  resolveAffectedCalendarIds,
  type StoredPushChannel,
} from "../../../src/core/source/push-channel";

const NOW = new Date("2026-08-12T00:00:00.000Z");

const makeChannel = (
  overrides: Partial<StoredPushChannel> = {},
): StoredPushChannel => ({
  accountId: "account-1",
  calendarId: "cal-1",
  createdAt: NOW,
  expiresAt: new Date(NOW.getTime() + 86_400_000),
  failureCount: 0,
  id: "channel-1",
  lastFailureAt: null,
  lastNotificationAt: null,
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
  verifiedAt: null,
  ...overrides,
});

describe("resolveAffectedCalendarIds", () => {
  it("resolves a calendar-scoped row to its own calendar without querying the account", async () => {
    const listAccountCalendars = vi.fn(() => Promise.resolve([]));

    await expect(resolveAffectedCalendarIds(makeChannel(), { listAccountCalendars }))
      .resolves.toEqual(["cal-1"]);
    expect(listAccountCalendars).not.toHaveBeenCalled();
  });

  it("fans an account-scoped row out to its live pull calendars only", async () => {
    const listAccountCalendars = vi.fn(() => Promise.resolve([
      { capabilities: ["pull"], disabled: false, id: "cal-a" },
      { capabilities: ["pull", "push"], disabled: false, id: "cal-b" },
      { capabilities: ["pull"], disabled: true, id: "cal-disabled" },
      { capabilities: ["pull"], disabled: false, id: "cal-c" },
    ]));

    await expect(resolveAffectedCalendarIds(
      makeChannel({ calendarId: null }),
      { listAccountCalendars },
    )).resolves.toEqual(["cal-a", "cal-b", "cal-c"]);
    expect(listAccountCalendars).toHaveBeenCalledWith("account-1");
  });

  it("excludes account calendars that lost the pull capability", async () => {
    const listAccountCalendars = vi.fn(() => Promise.resolve([
      { capabilities: ["push"], disabled: false, id: "cal-push-only" },
    ]));

    await expect(resolveAffectedCalendarIds(
      makeChannel({ calendarId: null }),
      { listAccountCalendars },
    )).resolves.toEqual([]);
  });
});
