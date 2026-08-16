import { describe, expect, it } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { CalendarListError } from "@keeper.sh/calendar/google";
import type { DiscoveredCalendar } from "@keeper.sh/calendar";
import {
  CalendarRefreshUnconfiguredError,
  CalendarRefreshUnsupportedError,
  runAccountCalendarRefresh,
} from "../../src/utils/calendar-rediscovery";
import type {
  AccountCalendarRefreshDependencies,
  RefreshableAccount,
} from "../../src/utils/calendar-rediscovery";

const NOW = new Date("2026-08-12T10:00:00.000Z");

const oauthAccount: RefreshableAccount = {
  authType: "oauth",
  calendarType: "oauth",
  hasImportedCalendar: true,
  id: "account-1",
  provider: "google",
  userId: "user-1",
};

const caldavAccount: RefreshableAccount = {
  authType: "caldav",
  calendarType: "caldav",
  hasImportedCalendar: true,
  id: "account-2",
  provider: "caldav",
  userId: "user-1",
};

const workCalendar: DiscoveredCalendar = {
  calendarUrl: null,
  externalCalendarId: "external-1",
  identityKey: "external-1",
  name: "Work",
  writable: true,
};

const emptyPlan = {
  crossAccountSkippedCount: 0,
  duplicateCount: 0,
  inserted: [] as { id: string; name: string }[],
  suppressed: false,
  toInsert: [] as DiscoveredCalendar[],
  toMarkUnavailable: [] as string[],
  toRetargetUrl: [] as { id: string; calendarUrl: string }[],
  toRevive: [] as string[],
  toUpdateCapabilities: [] as { id: string; capabilities: string[] }[],
  unchangedCount: 0,
};

const outlookAuthError = (): Error => {
  const error = new Error("Failed to list calendars: 401");
  error.name = "CalendarListError";
  return Object.assign(error, { authRequired: true, status: 401 });
};

const createHarness = (overrides: Partial<AccountCalendarRefreshDependencies> = {}) => {
  const applyPlanCalls: unknown[] = [];
  const discoverCalls: RefreshableAccount[] = [];
  const reauthCalls: string[] = [];
  const enqueuePushCalls: string[] = [];
  const markAttemptCalls: { accountId: string; now: Date }[] = [];
  const order: string[] = [];

  const configured: AccountCalendarRefreshDependencies = {
    applyPlan: () => Promise.resolve(emptyPlan),
    discoverCalendars: () => Promise.resolve([]),
    encryptionKey: "encryption-key",
    // eslint-disable-next-line @eslint/no-undefined @eslint-plugin-unicorn/no-useless-undefined
    enqueuePush: () => undefined,
    loadAccount: () => Promise.resolve(oauthAccount),
    markAttempt: () => Promise.resolve(),
    markNeedsReauthentication: () => Promise.resolve(),
    now: () => NOW,
    ...overrides,
  };

  const dependencies: AccountCalendarRefreshDependencies = {
    ...configured,
    applyPlan: (input) => {
      order.push("applyPlan");
      applyPlanCalls.push(input);
      return configured.applyPlan(input);
    },
    discoverCalendars: (account) => {
      order.push("discoverCalendars");
      discoverCalls.push(account);
      return configured.discoverCalendars(account);
    },
    enqueuePush: (userId) => {
      enqueuePushCalls.push(userId);
      configured.enqueuePush(userId);
    },
    markAttempt: (accountId, now) => {
      order.push("markAttempt");
      markAttemptCalls.push({ accountId, now });
      return configured.markAttempt(accountId, now);
    },
    markNeedsReauthentication: (accountId) => {
      reauthCalls.push(accountId);
      return configured.markNeedsReauthentication(accountId);
    },
  };

  return {
    applyPlanCalls,
    dependencies,
    discoverCalls,
    enqueuePushCalls,
    markAttemptCalls,
    order,
    reauthCalls,
  };
};

const run = (harness: ReturnType<typeof createHarness>) =>
  runAccountCalendarRefresh(
    { accountId: "account-1", userId: "user-1" },
    harness.dependencies,
  );

describe("runAccountCalendarRefresh", () => {
  it("writes nothing and flags reauthentication when CalDAV credentials are rejected", async () => {
    const harness = createHarness({
      discoverCalendars: () =>
        Promise.reject(new CalDAVAuthenticationError(new Error("401"))),
      loadAccount: () => Promise.resolve(caldavAccount),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalDAVAuthenticationError);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.reauthCalls).toEqual(["account-2"]);
  });

  it("writes nothing and flags reauthentication when the provider demands reauth", async () => {
    const harness = createHarness({
      discoverCalendars: () =>
        Promise.reject(new CalendarListError("Failed to list calendars: 401", 401, true)),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalendarListError);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.reauthCalls).toEqual(["account-1"]);
  });

  it("writes nothing and leaves credentials alone for a non-auth provider failure", async () => {
    const harness = createHarness({
      discoverCalendars: () =>
        Promise.reject(new CalendarListError("Failed to list calendars: 503", 503, false)),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalendarListError);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.reauthCalls).toEqual([]);
  });

  it("refuses to refresh a feed that has no account-level discovery", async () => {
    const harness = createHarness({
      loadAccount: () => Promise.resolve({
        authType: "none",
        calendarType: "ical",
        id: "account-3",
        provider: "ical",
        userId: "user-1",
      } as unknown as RefreshableAccount),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalendarRefreshUnsupportedError);
    expect(harness.discoverCalls).toEqual([]);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.markAttemptCalls).toEqual([]);
  });

  it("never enumerates a destination-only account, so its calendars stay unimported", async () => {
    const harness = createHarness({
      loadAccount: () => Promise.resolve({ ...caldavAccount, hasImportedCalendar: false }),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalendarRefreshUnsupportedError);
    expect(harness.discoverCalls).toEqual([]);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.markAttemptCalls).toEqual([]);
  });

  it("fails visibly when a CalDAV refresh has no encryption key configured", async () => {
    const harness = createHarness({
      encryptionKey: null,
      loadAccount: () => Promise.resolve(caldavAccount),
    });

    await expect(run(harness)).rejects.toBeInstanceOf(CalendarRefreshUnconfiguredError);
    expect(harness.discoverCalls).toEqual([]);
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.markAttemptCalls).toEqual([]);
  });

  it("classifies an Outlook calendar list rejection the same way as a Google one", async () => {
    const harness = createHarness({
      discoverCalendars: () => Promise.reject(outlookAuthError()),
    });

    await expect(run(harness)).rejects.toThrow("Failed to list calendars: 401");
    expect(harness.applyPlanCalls).toEqual([]);
    expect(harness.reauthCalls).toEqual(["account-1"]);
  });

  it("stamps the attempt cursor once, before contacting the provider", async () => {
    const harness = createHarness();

    await run(harness);

    expect(harness.markAttemptCalls).toEqual([{ accountId: "account-1", now: NOW }]);
    expect(harness.order.indexOf("markAttempt"))
      .toBeLessThan(harness.order.indexOf("discoverCalendars"));
  });

  it("stamps the attempt cursor even when discovery fails outright", async () => {
    const failures = [
      new CalendarListError("Failed to list calendars: 401", 401, true),
      new CalendarListError("Failed to list calendars: 503", 503, false),
      new CalDAVAuthenticationError(new Error("401")),
      outlookAuthError(),
      new Error("socket hang up"),
    ];

    for (const failure of failures) {
      // eslint-disable-next-line @eslint-plugin-promise/prefer-promise-reject-errors
      const harness = createHarness({ discoverCalendars: () => Promise.reject(failure) });

      await expect(run(harness)).rejects.toBe(failure);
      expect(harness.markAttemptCalls).toEqual([{ accountId: "account-1", now: NOW }]);
      expect(harness.order.indexOf("markAttempt"))
        .toBeLessThan(harness.order.indexOf("discoverCalendars"));
    }
  });

  it("hands a successful enumeration to the applier exactly once", async () => {
    const discovered = [{
      calendarUrl: null,
      externalCalendarId: "external-1",
      identityKey: "external-1",
      name: "Work",
      writable: true,
    }];
    const harness = createHarness({
      applyPlan: () => Promise.resolve({
        ...emptyPlan,
        inserted: [{ id: "calendar-1", name: "Work" }],
        toInsert: discovered,
      }),
      discoverCalendars: () => Promise.resolve(discovered),
    });

    const summary = await run(harness);

    expect(harness.applyPlanCalls).toHaveLength(1);
    expect(harness.applyPlanCalls[0]).toMatchObject({
      accountId: "account-1",
      calendarType: "oauth",
      discovered,
      now: NOW,
      userId: "user-1",
    });
    expect(summary.added).toEqual([{ id: "calendar-1", name: "Work" }]);
    expect(summary.checkedAt).toEqual(NOW);
    expect(summary.suppressed).toBe(false);
  });

  it("reports how much was enumerated and what a sibling account already owns", async () => {
    const discovered = [
      {
        calendarUrl: "https://cloud.example.com/dav/bob/work",
        externalCalendarId: null,
        identityKey: "/dav/bob/work",
        name: "Work",
        writable: true,
      },
      {
        calendarUrl: "https://cloud.example.com/dav/bob/shared",
        externalCalendarId: null,
        identityKey: "/dav/bob/shared",
        name: "Shared",
        writable: true,
      },
    ];
    const harness = createHarness({
      applyPlan: () => Promise.resolve({ ...emptyPlan, crossAccountSkippedCount: 1 }),
      discoverCalendars: () => Promise.resolve(discovered),
      loadAccount: () => Promise.resolve(caldavAccount),
    });

    const summary = await run(harness);

    expect(summary.discovered).toBe(2);
    expect(summary.crossAccountSkipped).toBe(1);
  });

  it("kicks a push sync when calendars were added", async () => {
    const harness = createHarness({
      applyPlan: () => Promise.resolve({
        ...emptyPlan,
        inserted: [{ id: "calendar-1", name: "Work" }],
        toInsert: [workCalendar],
      }),
      discoverCalendars: () => Promise.resolve([{
        calendarUrl: null,
        externalCalendarId: "external-1",
        identityKey: "external-1",
        name: "Work",
        writable: true,
      }]),
    });

    await run(harness);

    expect(harness.enqueuePushCalls).toEqual(["user-1"]);
  });

  it("kicks a push sync when calendars were reinstated", async () => {
    const harness = createHarness({
      applyPlan: () => Promise.resolve({ ...emptyPlan, toRevive: ["calendar-1"] }),
    });

    const summary = await run(harness);

    expect(harness.enqueuePushCalls).toEqual(["user-1"]);
    expect(summary.revived).toBe(1);
  });

  it("does not kick a push sync when a calendar merely disappeared", async () => {
    const harness = createHarness({
      applyPlan: () => Promise.resolve({
        ...emptyPlan,
        toMarkUnavailable: ["calendar-1"],
      }),
    });

    const summary = await run(harness);

    expect(harness.enqueuePushCalls).toEqual([]);
    expect(summary.unavailable).toBe(1);
    expect(summary.added).toEqual([]);
  });

  it("does not kick a push sync for a no-op refresh", async () => {
    const harness = createHarness({
      applyPlan: () => Promise.resolve({ ...emptyPlan, unchangedCount: 3 }),
    });

    const summary = await run(harness);

    expect(harness.enqueuePushCalls).toEqual([]);
    expect(summary.unchanged).toBe(3);
  });

  it("reports a suppressed enumeration without marking anything", async () => {
    const harness = createHarness({
      applyPlan: () => Promise.resolve({ ...emptyPlan, suppressed: true }),
    });

    const summary = await run(harness);

    expect(summary.suppressed).toBe(true);
    expect(summary.unavailable).toBe(0);
    expect(harness.enqueuePushCalls).toEqual([]);
  });

  it("declares no delete-shaped dependency", () => {
    const { dependencies } = createHarness();

    for (const key of Object.keys(dependencies)) {
      expect(key.toLowerCase()).not.toContain("delete");
      expect(key.toLowerCase()).not.toContain("remove");
      expect(key.toLowerCase()).not.toContain("prune");
    }
  });

  it("exposes no way for a caller to delete a calendar", async () => {
    const source = await Bun.file(
      `${import.meta.dirname}/../../src/utils/calendar-rediscovery.ts`,
    ).text();

    expect(source).not.toContain(".delete(");
    expect(source.toLowerCase()).not.toContain("deletecalendar");
    expect(source.toLowerCase()).not.toContain("removecalendar");
  });
});
