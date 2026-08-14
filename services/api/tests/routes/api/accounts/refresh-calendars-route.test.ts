import { describe, expect, it } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { handleRefreshCalendarsRoute } from "../../../../src/routes/api/accounts/refresh-calendars-route";
import type { RefreshCalendarsRouteDependencies } from "../../../../src/routes/api/accounts/refresh-calendars-route";

const CHECKED_AT = new Date("2026-08-12T10:00:00.000Z");
const COOLDOWN_SECONDS = 60;

const readJson = (response: Response): Promise<Record<string, unknown>> =>
  response.json() as Promise<Record<string, unknown>>;

const summary = {
  added: [{ id: "calendar-1", name: "Work" }],
  checkedAt: CHECKED_AT,
  crossAccountSkipped: 0,
  discovered: 4,
  duplicates: 0,
  revived: 1,
  suppressed: false,
  unavailable: 2,
  unchanged: 3,
};

const createHarness = (overrides: Partial<RefreshCalendarsRouteDependencies> = {}) => {
  const refreshCalls: { accountId: string; userId: string }[] = [];
  const lockKeys: string[] = [];
  const releases: string[] = [];
  const cooldownCalls: string[] = [];

  const dependencies: RefreshCalendarsRouteDependencies = {
    acquireRefreshLock: (accountId) => {
      lockKeys.push(accountId);
      return Promise.resolve({
        acquired: true as const,
        handle: {
          release: () => {
            releases.push(accountId);
            return Promise.resolve();
          },
        },
      });
    },
    claimRefreshCooldown: (userId) => {
      cooldownCalls.push(userId);
      return Promise.resolve({ allowed: true as const });
    },
    cooldownSeconds: COOLDOWN_SECONDS,
    loadAccounts: () =>
      Promise.resolve([
        { id: "account-1", provider: "google" },
        { id: "account-2", provider: "caldav" },
      ]),
    refreshCalendars: (options) => {
      refreshCalls.push(options);
      return Promise.resolve(summary);
    },
    runConcurrently: (tasks) => Promise.allSettled(tasks.map((task) => task())),
    ...overrides,
  };

  return { cooldownCalls, dependencies, lockKeys, refreshCalls, releases };
};

describe("handleRefreshCalendarsRoute", () => {
  it("refreshes every refreshable account the user owns", async () => {
    const harness = createHarness();

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(200);
    expect(harness.refreshCalls).toEqual([
      { accountId: "account-1", userId: "user-1" },
      { accountId: "account-2", userId: "user-1" },
    ]);
    await expect(readJson(response)).resolves.toMatchObject({
      accounts: 2,
      added: 2,
      failed: 0,
      refreshed: 2,
      revived: 2,
      unavailable: 4,
    });
  });

  it("tells the client how long the cooldown lasts so it can disable the control", async () => {
    const harness = createHarness();

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toMatchObject({
      cooldownSeconds: COOLDOWN_SECONDS,
    });
  });

  it("claims the cooldown per user before doing any work", async () => {
    const harness = createHarness();

    await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(harness.cooldownCalls).toEqual(["user-1"]);
  });

  it("refuses a refresh inside the cooldown without touching any account", async () => {
    const harness = createHarness({
      claimRefreshCooldown: () =>
        Promise.resolve({ allowed: false as const, retryAfterSeconds: 42 }),
    });

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(harness.refreshCalls).toEqual([]);
  });

  it("keeps refreshing the remaining accounts when one fails authentication", async () => {
    const harness = createHarness({
      refreshCalendars: ({ accountId }) => {
        if (accountId === "account-1") {
          return Promise.reject(new CalDAVAuthenticationError("Unauthorized"));
        }
        return Promise.resolve(summary);
      },
    });

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      accounts: 2,
      failed: 1,
      refreshed: 1,
    });
  });

  it("releases the account mutex even when the refresh throws", async () => {
    const harness = createHarness({
      refreshCalendars: () => Promise.reject(new Error("boom")),
    });

    await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(harness.releases).toEqual(["account-1", "account-2"]);
  });

  it("skips an account whose mutex is already held by the cron", async () => {
    const harness = createHarness({
      acquireRefreshLock: (accountId) => {
        if (accountId === "account-1") {
          return Promise.resolve({ acquired: false as const });
        }
        return Promise.resolve({
          acquired: true as const,
          handle: { release: () => Promise.resolve() },
        });
      },
    });

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    await expect(readJson(response)).resolves.toMatchObject({
      failed: 0,
      refreshed: 1,
      skipped: 1,
    });
    expect(harness.refreshCalls).toEqual([{ accountId: "account-2", userId: "user-1" }]);
  });

  it("succeeds with nothing to do when the user has no refreshable accounts", async () => {
    const harness = createHarness({ loadAccounts: () => Promise.resolve([]) });

    const response = await handleRefreshCalendarsRoute({ userId: "user-1" }, harness.dependencies);

    expect(response.status).toBe(200);
    await expect(readJson(response)).resolves.toMatchObject({
      accounts: 0,
      added: 0,
      failed: 0,
      refreshed: 0,
    });
    expect(harness.lockKeys).toEqual([]);
  });
});
