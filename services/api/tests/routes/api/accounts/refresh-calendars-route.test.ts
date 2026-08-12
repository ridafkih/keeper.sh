import { describe, expect, it } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { CalendarListError } from "@keeper.sh/calendar/google";
import {
  CalendarRefreshUnconfiguredError,
  CalendarRefreshUnsupportedError,
} from "../../../../src/utils/calendar-rediscovery";
import { handleRefreshCalendarsRoute } from "../../../../src/routes/api/accounts/[id]/refresh-calendars-route";
import type { RefreshCalendarsRouteDependencies } from "../../../../src/routes/api/accounts/[id]/refresh-calendars-route";

const CHECKED_AT = new Date("2026-08-12T10:00:00.000Z");

const readJson = (response: Response): Promise<Record<string, unknown>> =>
  response.json() as Promise<Record<string, unknown>>;

const summary = {
  added: [{ id: "calendar-1", name: "Work" }],
  checkedAt: CHECKED_AT,
  crossAccountSkipped: 1,
  discovered: 6,
  duplicates: 0,
  revived: 1,
  suppressed: false,
  unavailable: 2,
  unchanged: 3,
};

const outlookAuthError = (): Error => {
  const error = new Error("Failed to list calendars: 401");
  error.name = "CalendarListError";
  return Object.assign(error, { authRequired: true, status: 401 });
};

const createHarness = (overrides: Partial<RefreshCalendarsRouteDependencies> = {}) => {
  const refreshCalls: unknown[] = [];
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
    claimRefreshCooldown: (accountId) => {
      cooldownCalls.push(accountId);
      return Promise.resolve({ allowed: true as const });
    },
    loadAccount: () => Promise.resolve({ id: "account-1", provider: "google" }),
    refreshCalendars: (options) => {
      refreshCalls.push(options);
      return Promise.resolve(summary);
    },
    ...overrides,
  };

  return { cooldownCalls, dependencies, lockKeys, refreshCalls, releases };
};

const OWNED_PARAMS: Record<string, string> = { id: "account-1" };

const call = (
  harness: ReturnType<typeof createHarness>,
  params: Record<string, string> = OWNED_PARAMS,
): Promise<Response> =>
  handleRefreshCalendarsRoute({ params, userId: "user-1" }, harness.dependencies);

const expectLockReleased = async (
  refreshCalendars: RefreshCalendarsRouteDependencies["refreshCalendars"],
): Promise<void> => {
  const harness = createHarness({ refreshCalendars });

  await call(harness).catch(() => null);

  expect(harness.releases).toEqual(harness.lockKeys);
  expect(harness.releases).toHaveLength(1);
};

describe("handleRefreshCalendarsRoute", () => {
  it("rejects a malformed account id", async () => {
    const harness = createHarness();

    const response = await call(harness, {});

    expect(response.status).toBe(400);
    expect(harness.refreshCalls).toEqual([]);
  });

  it("returns 404 for an account the caller does not own, before any provider call", async () => {
    const harness = createHarness({ loadAccount: () => Promise.resolve(null) });

    const response = await call(harness);

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({ error: "Account not found" });
    expect(harness.refreshCalls).toEqual([]);
    expect(harness.lockKeys).toEqual([]);
    expect(harness.cooldownCalls).toEqual([]);
  });

  it("throttles a repeated refresh with a Retry-After header", async () => {
    const harness = createHarness({
      claimRefreshCooldown: () =>
        Promise.resolve({ allowed: false as const, retryAfterSeconds: 42 }),
    });

    const response = await call(harness);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(harness.refreshCalls).toEqual([]);
  });

  it("returns 409 when a refresh is already running for the account", async () => {
    const harness = createHarness({
      acquireRefreshLock: () => Promise.resolve({ acquired: false as const }),
    });

    const response = await call(harness);

    expect(response.status).toBe(409);
    expect(harness.refreshCalls).toEqual([]);
    expect(harness.releases).toEqual([]);
    expect(harness.cooldownCalls).toEqual([]);
  });

  it("claims the cooldown only after the account mutex was won", async () => {
    const harness = createHarness();

    await call(harness);

    expect(harness.lockKeys).toEqual(["account-1"]);
    expect(harness.cooldownCalls).toEqual(["account-1"]);
  });

  it("releases the account mutex when the cooldown refuses the request", async () => {
    const harness = createHarness({
      claimRefreshCooldown: () =>
        Promise.resolve({ allowed: false as const, retryAfterSeconds: 42 }),
    });

    await call(harness);

    expect(harness.releases).toEqual(["account-1"]);
  });

  it("reports what changed on a successful refresh", async () => {
    const harness = createHarness();

    const response = await call(harness);

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      added: [{ id: "calendar-1", name: "Work" }],
      checkedAt: CHECKED_AT.toISOString(),
      revived: 1,
      suppressed: false,
      unavailable: 2,
      unchanged: 3,
    });
    expect(harness.refreshCalls).toEqual([{ accountId: "account-1", userId: "user-1" }]);
    expect(harness.releases).toEqual(["account-1"]);
  });

  it("surfaces a CalDAV authentication failure as a reauthentication prompt", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalDAVAuthenticationError(new Error("401"))),
    });

    const response = await call(harness);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({ authRequired: true });
  });

  it("surfaces an OAuth reauthentication failure as a reauthentication prompt", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalendarListError("Failed to list calendars: 401", 401, true)),
    });

    const response = await call(harness);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({ authRequired: true });
  });

  it("surfaces an Outlook reauthentication failure as the same reauthentication prompt", async () => {
    const harness = createHarness({
      refreshCalendars: () => Promise.reject(outlookAuthError()),
    });

    const response = await call(harness);

    expect(response.status).toBe(401);
    expect(await readJson(response)).toMatchObject({ authRequired: true });
    expect(harness.releases).toEqual(["account-1"]);
  });

  it("surfaces a non-auth provider failure as a bad request", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalendarListError("Failed to list calendars: 503", 503, false)),
    });

    const response = await call(harness);

    expect(response.status).toBe(400);
  });

  it("names the missing server configuration when CalDAV refresh is unconfigured", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalendarRefreshUnconfiguredError("Encryption key not configured")),
    });

    const response = await call(harness);

    expect(response.status).toBe(500);
    const body = await readJson(response);
    expect(String(body.error).toLowerCase()).toContain("caldav");
  });

  it.each([
    ["a DOMException timeout", (): unknown => new DOMException("timed out", "TimeoutError")],
    ["a request timeout error", (): unknown => {
      const error = new Error("Request timed out after 30000ms");
      error.name = "TimeoutError";
      return error;
    }],
  ])("classifies %s as a provider request timeout", async (_label, buildError) => {
    const harness = createHarness({
      refreshCalendars: () => Promise.reject(buildError()),
    });

    const response = await call(harness);

    expect(response.status).toBe(400);
    const timeoutBody = await readJson(response);
    expect(String(timeoutBody.error).toLowerCase()).toContain("timed out");
  });

  it("releases the refresh lock after a provider request timeout", async () => {
    await expectLockReleased(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")));
  });

  it("rejects refreshing an account with no account-level discovery", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalendarRefreshUnsupportedError("Refresh is not supported")),
    });

    const response = await call(harness);

    expect(response.status).toBe(400);
  });

  it("releases the refresh lock after a CalDAV authentication failure", async () => {
    await expectLockReleased(() =>
      Promise.reject(new CalDAVAuthenticationError(new Error("401"))));
  });

  it("releases the refresh lock after a provider API failure", async () => {
    await expectLockReleased(() =>
      Promise.reject(new CalendarListError("Failed to list calendars: 503", 503, false)));
  });

  it("releases the refresh lock after an unconfigured CalDAV refresh", async () => {
    await expectLockReleased(() =>
      Promise.reject(new CalendarRefreshUnconfiguredError("Encryption key not configured")));
  });

  it("releases the refresh lock after an unsupported account", async () => {
    await expectLockReleased(() =>
      Promise.reject(new CalendarRefreshUnsupportedError("Refresh is not supported")));
  });

  it("releases the refresh lock after an unexpected failure", async () => {
    await expectLockReleased(() => Promise.reject(new Error("boom")));
  });

  it("releases the refresh lock after an Outlook authentication failure", async () => {
    await expectLockReleased(() => Promise.reject(outlookAuthError()));
  });
});
