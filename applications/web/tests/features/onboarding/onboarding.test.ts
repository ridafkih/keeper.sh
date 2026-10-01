import { describe, expect, it } from "vitest";
import type { SyncDetail } from "@keeper.sh/data-schemas";
import { CONNECT_PROVIDERS } from "../../../src/lib/connect-providers";
import { readOnboardingCookie } from "../../../src/lib/onboarding-cookie";
import { needsOnboardingLookup, resolveOnboardingRedirect } from "../../../src/lib/route-access-guards";
import type { CompositeSyncState } from "../../../src/state/sync";
import { canStartFirstSync, connectLabel, groupConnectedAccounts } from "../../../src/features/onboarding/onboarding-accounts";
import { resolveFirstRunProgress } from "../../../src/features/onboarding/first-run";
import { readOnboardingSearch } from "../../../src/features/onboarding/onboarding-steps";
import { describeCopies, describeWindow, joinNames } from "../../../src/features/onboarding/sync-estimate";
import { makeSource } from "../setup/fixtures";

const google = CONNECT_PROVIDERS.find((provider) => provider.id === "google");
if (!google) throw new Error("google connect option missing");

describe("onboarding redirect", () => {
  it("sends a pending person to onboarding from anywhere in the dashboard", () => {
    expect(resolveOnboardingRedirect("pending", "/dashboard")).toBe("/onboarding");
    expect(resolveOnboardingRedirect("pending", "/dashboard/syncs/new")).toBe("/onboarding");
  });

  it("leaves people alone once they finish or skip, and never loops on onboarding itself", () => {
    expect(resolveOnboardingRedirect("done", "/dashboard")).toBeNull();
    expect(resolveOnboardingRedirect(null, "/dashboard")).toBeNull();
    expect(resolveOnboardingRedirect("pending", "/onboarding/")).toBeNull();
  });

  it("asks the API only when the cookie is missing", () => {
    expect(needsOnboardingLookup(null, "/dashboard")).toBe(true);
    expect(needsOnboardingLookup("done", "/dashboard")).toBe(false);
    expect(needsOnboardingLookup(null, "/onboarding")).toBe(false);
  });

  it("reads the cookie the API sets", () => {
    expect(readOnboardingCookie("keeper.has_session=1; keeper.onboarding=pending")).toBe("pending");
    expect(readOnboardingCookie("keeper.onboarding=done")).toBe("done");
    expect(readOnboardingCookie("keeper.onboarding=other")).toBeNull();
    expect(readOnboardingCookie("")).toBeNull();
  });
});

describe("onboarding search", () => {
  it("falls back to the first step for anything it doesn't know", () => {
    expect(readOnboardingSearch({ accountId: "account-1", step: "connect" })).toMatchObject({ accountId: "account-1", step: "connect" });
    expect(readOnboardingSearch({ step: "elsewhere" }).step).toBeUndefined();
  });
});

describe("connect step", () => {
  const work = makeSource("work", "google-1", ["pull", "push"], { email: "alex@acme.co", name: "Work" });
  const team = makeSource("team", "google-1", ["pull", "push"], { email: "alex@acme.co", name: "Team" });
  const feed = makeSource("gym", "feed-1", ["pull"], { name: "Gym", provider: "ics" });

  it("groups calendars by account", () => {
    expect(groupConnectedAccounts([work, team])).toEqual([
      { accountId: "google-1", calendarNames: ["Work", "Team"], label: "alex@acme.co", provider: "google" },
    ]);
  });

  it("offers another account once a provider is connected", () => {
    expect(connectLabel(google, [])).toBe("Connect Google Calendar");
    expect(connectLabel(google, groupConnectedAccounts([work]))).toBe("Connect Another Google Account");
  });

  it("needs two calendars, one of which Keeper can write to", () => {
    expect(canStartFirstSync([work])).toBe(false);
    expect(canStartFirstSync([work, feed])).toBe(true);
    expect(canStartFirstSync([feed, { ...feed, id: "gym-2" }])).toBe(false);
  });
});

describe("estimate copy", () => {
  it("names the copies the way the sync makes them", () => {
    expect(describeCopies(1, "busy_only")).toBe("1 busy block");
    expect(describeCopies(1200, "title_only")).toBe(`${(1200).toLocaleString()} event copies`);
  });

  it("describes the window when every destination shares it", () => {
    const total = { count: 570, futureRange: "2_years", historicRange: "1_month" } as const;
    expect(describeWindow({ nearTerm: { count: 21, days: 28 }, total })).toBe("from 1 month back to 2 years ahead");
    expect(describeWindow({ nearTerm: { count: 21, days: 28 }, total: { ...total, futureRange: null } }))
      .toBe("across each calendar's sync window");
  });

  it("joins calendar names into a sentence", () => {
    expect(joinNames(["Work"])).toBe("Work");
    expect(joinNames(["Work", "Personal", "Family"])).toBe("Work, Personal and Family");
  });
});

describe("first run progress", () => {
  const aggregate = (overrides: Partial<CompositeSyncState>): CompositeSyncState => ({
    connected: true,
    hasReceivedAggregate: true,
    lastSyncedAt: null,
    progressPercent: 100,
    seq: 1,
    state: "idle",
    syncEventsProcessed: 0,
    syncEventsRemaining: 0,
    syncEventsTotal: 0,
    ...overrides,
  });
  const sync = (lastSyncedAt: (string | null)[]): SyncDetail => ({
    copiedCount: 570,
    destinations: lastSyncedAt.map((value, index) => ({
      calendarId: `calendar-${index}`,
      copiedCount: 0,
      lastSyncedAt: value,
      problem: null,
      skippedCount: 0,
    })),
  } as unknown as SyncDetail);

  it("counts while the totals are still coming in", () => {
    expect(resolveFirstRunProgress(sync([null, null]), aggregate({ progressPercent: 3, state: "syncing" })))
      .toEqual({ kind: "counting", percent: 3 });
  });

  it("shows the live count once the total is known", () => {
    expect(resolveFirstRunProgress(sync([null, null]), aggregate({
      progressPercent: 28,
      state: "syncing",
      syncEventsProcessed: 161,
      syncEventsTotal: 570,
    }))).toEqual({ kind: "copying", percent: 28, processed: 161, total: 570 });
  });

  it("finishes only when every destination has synced", () => {
    expect(resolveFirstRunProgress(sync(["2026-10-01T12:00:00Z", null]), aggregate({})).kind).toBe("counting");
    expect(resolveFirstRunProgress(sync(["2026-10-01T12:00:00Z", "2026-10-01T12:01:00Z"]), aggregate({})))
      .toEqual({ copied: 570, kind: "finished" });
  });
});
