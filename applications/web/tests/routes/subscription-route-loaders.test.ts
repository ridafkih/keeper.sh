import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { HttpError } from "../../src/lib/fetcher";
import { Route as UpgradeRoute } from "../../src/routes/(dashboard)/dashboard/upgrade/index";
import { Route as SettingsRoute } from "../../src/routes/(dashboard)/dashboard/settings/index";
import { Route as DashboardRoute } from "../../src/routes/(dashboard)/dashboard/index";

type RouteOptions = { options: Record<string, unknown> };

const upgradeRoute = UpgradeRoute as unknown as RouteOptions;
const settingsRoute = SettingsRoute as unknown as RouteOptions;
const dashboardRoute = DashboardRoute as unknown as RouteOptions;

const CUSTOMER_STATE_PATH = "/api/auth/customer/state";
const ENTITLEMENTS_PATH = "/api/entitlements";
const CAPABILITIES_PATH = "/api/auth/capabilities";

const capabilitiesBody = {
  commercialMode: true,
  credentialMode: "email",
  disableLocalAuth: false,
  requiresEmailVerification: true,
  socialProviders: { google: true, microsoft: false, oidc: false },
  supportsChangePassword: true,
  supportsPasskeys: true,
  supportsPasswordReset: true,
};

type Responder = (path: string, callIndex: number) => unknown;

const createApi = (respond: Responder) => {
  const calls: string[] = [];
  const fetchApi = async <T,>(path: string): Promise<T> => {
    const callIndex = calls.length;
    calls.push(path);
    const result = respond(path, callIndex);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return { calls, fetchApi };
};

const runUpgradeLoader = async (
  fetchApi: <T>(path: string) => Promise<T>,
  { hasSession = true, commercialMode = true } = {},
) => {
  const loader = upgradeRoute.options.loader as (args: unknown) => Promise<unknown>;
  return loader({
    context: {
      auth: { hasSession: () => hasSession },
      fetchApi,
      runtimeConfig: { commercialMode },
    },
  });
};

const runSettingsLoader = async (
  fetchApi: <T>(path: string) => Promise<T>,
  { commercialMode = true } = {},
) => {
  const loader = settingsRoute.options.loader as (args: unknown) => Promise<unknown>;
  return loader({
    context: { fetchApi, runtimeConfig: { commercialMode } },
  });
};

const runDashboardLoader = async (
  fetchApi: <T>(path: string) => Promise<T>,
  { commercialMode = true } = {},
) => {
  const loader = dashboardRoute.options.loader as (args: unknown) => Promise<unknown>;
  return loader({
    context: { fetchApi, runtimeConfig: { commercialMode } },
  });
};

const captureThrow = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("expected the loader to throw");
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("upgrade route loader", () => {
  it("hands the page a free plan when the customer state reports no subscription", async () => {
    const { calls, fetchApi } = createApi(() => ({ activeSubscriptions: [] }));

    await expect(runUpgradeLoader(fetchApi)).resolves.toEqual({
      subscription: { plan: "free", interval: null },
    });
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("keeps a paying customer off the upgrade page when the customer state read fails", async () => {
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
    );

    const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/dashboard");
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("still shows the upgrade page to a genuinely free user during the outage", async () => {
    const { fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(429, path) : { plan: "free" },
    );

    await expect(runUpgradeLoader(fetchApi)).resolves.toEqual({
      subscription: { plan: "free", interval: null },
    });
  });

  it("redirects to login when the customer state is unauthorized", async () => {
    const { calls, fetchApi } = createApi(
      (path) => new HttpError(401, path),
    );

    const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/login");
    expect(calls).toEqual([CUSTOMER_STATE_PATH]);
  });

  it("redirects to login when only the fallback discovers the session is gone", async () => {
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH
        ? new HttpError(500, path)
        : new HttpError(401, path),
    );

    const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/login");
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("does not read any plan endpoint without a session", async () => {
    const { calls, fetchApi } = createApi(() => ({ activeSubscriptions: [] }));

    const thrown = await captureThrow(() =>
      runUpgradeLoader(fetchApi, { hasSession: false }),
    );

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/login");
    expect(calls).toEqual([]);
  });

  it("surfaces the failure rather than presenting a paying customer as free when both reads are down", async () => {
    const { calls, fetchApi } = createApi((path) => new HttpError(503, path));

    const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));

    expect(isRedirect(thrown)).toBe(false);
    expect(thrown).toBeInstanceOf(HttpError);
    expect(calls).toEqual([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]);
  });

  it("produces the same redirect on every repeated run while the outage persists", async () => {
    const outcomes: string[] = [];
    const sequences: string[][] = [];

    for (let run = 0; run < 4; run += 1) {
      const { calls, fetchApi } = createApi((path) =>
        path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
      );
      const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));
      outcomes.push((thrown as { options: { to: string } }).options.to);
      sequences.push(calls);
    }

    expect(outcomes).toEqual(Array(4).fill("/dashboard"));
    expect(sequences).toEqual(
      Array(4).fill([CUSTOMER_STATE_PATH, ENTITLEMENTS_PATH]),
    );
  });

  it("does not oscillate between the upgrade page and the dashboard as the read flaps", async () => {
    const outcomes: string[] = [];

    for (let run = 0; run < 6; run += 1) {
      const failing = run % 2 === 1;
      const { fetchApi } = createApi((path) => {
        if (path === CUSTOMER_STATE_PATH) {
          return failing
            ? new HttpError(500, path)
            : { activeSubscriptions: [{ recurringInterval: "year" }] };
        }
        return { plan: "pro" };
      });
      const thrown = await captureThrow(() => runUpgradeLoader(fetchApi));
      outcomes.push((thrown as { options: { to: string } }).options.to);
    }

    expect(outcomes).toEqual(Array(6).fill("/dashboard"));
  });

  it("sends a commercial-mode-off deployment away from the upgrade page before reading anything", async () => {
    const beforeLoad = upgradeRoute.options.beforeLoad as (args: unknown) => unknown;
    const { calls, fetchApi } = createApi(() => ({ activeSubscriptions: [] }));

    const thrown = await captureThrow(async () =>
      beforeLoad({
        context: {
          auth: { hasSession: () => true },
          fetchApi,
          runtimeConfig: { commercialMode: false },
        },
      }),
    );

    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe("/dashboard");
    expect(calls).toEqual([]);
  });
});

describe("settings route loader", () => {
  const respondWithCapabilities =
    (respond: Responder): Responder =>
    (path, callIndex) =>
      path === CAPABILITIES_PATH ? capabilitiesBody : respond(path, callIndex);

  it("still renders the page when the plan reads are down", async () => {
    const { fetchApi } = createApi(
      respondWithCapabilities((path) => new HttpError(503, path)),
    );

    const data = (await runSettingsLoader(fetchApi)) as { authCapabilities: unknown };

    expect(data.authCapabilities).toMatchObject({ credentialMode: "email" });
  });

  it("no longer reads the plan, which the dashboard preloads instead", async () => {
    const { calls, fetchApi } = createApi(respondWithCapabilities(() => ({})));

    await runSettingsLoader(fetchApi);

    expect(calls).toEqual([CAPABILITIES_PATH]);
  });
});

describe("dashboard route loader", () => {
  it("preloads a paying customer as pro through the fallback", async () => {
    const { calls, fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
    );

    const data = (await runDashboardLoader(fetchApi)) as { subscription: unknown };

    expect(data.subscription).toEqual({ plan: "pro", interval: null });
    expect(calls).toContain(ENTITLEMENTS_PATH);
  });

  it("never preloads a plan the fallback did not actually report", async () => {
    const { fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "enterprise" },
    );

    const data = (await runDashboardLoader(fetchApi)) as { subscription: unknown };

    expect(data.subscription).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("still renders the page when both plan reads are down", async () => {
    const { fetchApi } = createApi((path) => new HttpError(503, path));

    const data = (await runDashboardLoader(fetchApi)) as { subscription: unknown };

    expect(data.subscription).toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("reports commercial mode from the loader, so the row server-renders", async () => {
    const { fetchApi } = createApi((path) =>
      path === CUSTOMER_STATE_PATH ? new HttpError(500, path) : { plan: "pro" },
    );

    const data = (await runDashboardLoader(fetchApi)) as { commercialMode: unknown };

    expect(data.commercialMode).toBe(true);
  });

  it("reports commercial mode as off without reaching for the window", async () => {
    const { fetchApi } = createApi(() => ({}));

    const data = (await runDashboardLoader(fetchApi, { commercialMode: false })) as {
      commercialMode: unknown;
    };

    expect(data.commercialMode).toBe(false);
  });

  it("does not read the plan at all outside commercial mode", async () => {
    const { calls, fetchApi } = createApi(() => ({}));

    const data = (await runDashboardLoader(fetchApi, { commercialMode: false })) as {
      subscription: unknown;
    };

    expect(data.subscription).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("converges on the same preload across repeated runs during the outage", async () => {
    const results: unknown[] = [];

    for (let run = 0; run < 3; run += 1) {
      const { fetchApi } = createApi((path) =>
        path === CUSTOMER_STATE_PATH ? new HttpError(429, path) : { plan: "pro" },
      );
      const data = (await runDashboardLoader(fetchApi)) as { subscription: unknown };
      results.push(data.subscription);
    }

    expect(results).toEqual(Array(3).fill({ plan: "pro", interval: null }));
  });

  it("does not send a paying customer to a login screen it cannot reach when the session expires", async () => {
    const { fetchApi } = createApi((path) => new HttpError(401, path));

    const data = (await runDashboardLoader(fetchApi)) as { subscription: unknown };

    expect(data.subscription).toBeUndefined();
  });
});
