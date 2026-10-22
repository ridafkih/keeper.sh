import { describe, expect, it, vi } from "vitest";
import { CalendarListError } from "@keeper.sh/calendar/google";
import {
  CALENDAR_ACCESS_REQUIRED_MESSAGE,
  handleAccountRefreshRoute,
} from "../../../../src/routes/api/accounts/[id]/refresh-route";
import type { AccountRefreshRouteDependencies } from "../../../../src/routes/api/accounts/[id]/refresh-route";
import { AccountNotFoundError } from "../../../../src/utils/refresh-account-calendars";

const CONTEXT = { accountId: "account-1", userId: "user-1" };

const createDependencies = (
  overrides: Partial<AccountRefreshRouteDependencies> = {},
): AccountRefreshRouteDependencies => ({
  markNeedsReauthentication: vi.fn(() => Promise.resolve()),
  refreshAccountCalendars: vi.fn(() =>
    Promise.resolve({ imported: 1, missing: 0, restored: 0 })),
  ...overrides,
});

describe("handleAccountRefreshRoute", () => {
  it("returns the refresh result", async () => {
    const dependencies = createDependencies();

    const response = await handleAccountRefreshRoute(CONTEXT, dependencies);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ imported: 1, missing: 0, restored: 0 });
    expect(dependencies.refreshAccountCalendars).toHaveBeenCalledWith("user-1", "account-1");
    expect(dependencies.markNeedsReauthentication).not.toHaveBeenCalled();
  });

  it("asks the user to reconnect when the provider refuses to list calendars", async () => {
    const dependencies = createDependencies({
      refreshAccountCalendars: vi.fn(() =>
        Promise.reject(new CalendarListError("Failed to list calendars: 403", 403, true))),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, dependencies);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: CALENDAR_ACCESS_REQUIRED_MESSAGE });
    expect(dependencies.markNeedsReauthentication).toHaveBeenCalledWith("account-1");
  });

  it("asks the user to reconnect when the refresh token is no longer valid", async () => {
    const tokenError = Object.assign(new Error("Token refresh failed (400)"), {
      oauthReauthRequired: true,
    });
    const dependencies = createDependencies({
      refreshAccountCalendars: vi.fn(() => Promise.reject(tokenError)),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, dependencies);

    expect(response.status).toBe(409);
    expect(dependencies.markNeedsReauthentication).toHaveBeenCalledWith("account-1");
  });

  it("returns 404 for an account the user does not own", async () => {
    const dependencies = createDependencies({
      refreshAccountCalendars: vi.fn(() => Promise.reject(new AccountNotFoundError())),
    });

    const response = await handleAccountRefreshRoute(CONTEXT, dependencies);

    expect(response.status).toBe(404);
    expect(dependencies.markNeedsReauthentication).not.toHaveBeenCalled();
  });

  it("leaves transient provider failures to the error handler", async () => {
    const transient = new CalendarListError("Failed to list calendars: 503", 503, false);
    const dependencies = createDependencies({
      refreshAccountCalendars: vi.fn(() => Promise.reject(transient)),
    });

    await expect(handleAccountRefreshRoute(CONTEXT, dependencies)).rejects.toBe(transient);
    expect(dependencies.markNeedsReauthentication).not.toHaveBeenCalled();
  });
});
