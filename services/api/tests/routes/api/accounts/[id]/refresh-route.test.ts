import { describe, expect, it } from "vitest";
import { CalDAVAuthenticationError } from "@keeper.sh/calendar/caldav";
import { handleAccountRefreshRoute } from "../../../../../src/routes/api/accounts/[id]/refresh-route";
import type { AccountRefreshRouteDependencies } from "../../../../../src/routes/api/accounts/[id]/refresh-route";
import {
  CalendarAccountNotFoundError,
  CalendarRefreshUnsupportedError,
} from "../../../../../src/utils/calendar-rediscovery";

const CHECKED_AT = new Date("2026-08-12T10:00:00.000Z");
const CONTEXT = { accountId: "account-caldav", userId: "user-1" };

const summary = {
  added: [{ id: "calendar-1", name: "Work" }, { id: "calendar-2", name: "Home" }],
  checkedAt: CHECKED_AT,
  crossAccountSkipped: 0,
  discovered: 4,
  duplicates: 0,
  revived: 1,
  suppressed: false,
  unavailable: 3,
  unchanged: 1,
};

const readJson = (response: Response): Promise<Record<string, unknown>> =>
  response.json() as Promise<Record<string, unknown>>;

const createHarness = (overrides: Partial<AccountRefreshRouteDependencies> = {}) => {
  const refreshCalls: { accountId: string; userId: string }[] = [];
  const lockKeys: string[] = [];
  const releases: string[] = [];

  const dependencies: AccountRefreshRouteDependencies = {
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
    refreshCalendars: (options) => {
      refreshCalls.push(options);
      return Promise.resolve(summary);
    },
    ...overrides,
  };

  return { dependencies, lockKeys, refreshCalls, releases };
};

describe("handleAccountRefreshRoute", () => {
  it("refreshes a CalDAV account and reports imported, missing and restored calendars", async () => {
    const harness = createHarness();

    const response = await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(response.status).toBe(200);
    expect(harness.refreshCalls).toEqual([CONTEXT]);
    await expect(readJson(response)).resolves.toEqual({ imported: 2, missing: 3, restored: 1 });
  });

  it("holds the account mutex for the refresh and releases it afterwards", async () => {
    const harness = createHarness();

    await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(harness.lockKeys).toEqual(["account-caldav"]);
    expect(harness.releases).toEqual(["account-caldav"]);
  });

  it("answers conflict without refreshing while another refresh holds the account", async () => {
    const harness = createHarness({
      acquireRefreshLock: () => Promise.resolve({ acquired: false as const }),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(response.status).toBe(409);
    expect(harness.refreshCalls).toEqual([]);
    await expect(readJson(response)).resolves.toEqual({
      error: "This account's calendars are already being refreshed.",
    });
  });

  it("answers not found for an account the user does not own", async () => {
    const harness = createHarness({
      refreshCalendars: () => Promise.reject(new CalendarAccountNotFoundError()),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(response.status).toBe(404);
    expect(harness.releases).toEqual(["account-caldav"]);
  });

  it("explains why an account without calendar discovery cannot be refreshed", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(
          new CalendarRefreshUnsupportedError("This account does not support calendar discovery."),
        ),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(response.status).toBe(400);
    await expect(readJson(response)).resolves.toEqual({
      error: "This account does not support calendar discovery.",
    });
  });

  it("asks the user to reconnect when the provider rejects the account's credentials", async () => {
    const harness = createHarness({
      refreshCalendars: () =>
        Promise.reject(new CalDAVAuthenticationError(new Error("401"))),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, harness.dependencies);

    expect(response.status).toBe(401);
    await expect(readJson(response)).resolves.toEqual({
      error: "The provider rejected this account's sign-in. Reconnect it, then refresh again.",
    });
    expect(harness.releases).toEqual(["account-caldav"]);
  });

  it("surfaces unexpected failures to the request's error handling", async () => {
    const failure = new Error("database unavailable");
    const harness = createHarness({ refreshCalendars: () => Promise.reject(failure) });

    await expect(handleAccountRefreshRoute(CONTEXT, harness.dependencies)).rejects.toBe(failure);
    expect(harness.releases).toEqual(["account-caldav"]);
  });
});
