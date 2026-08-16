import { beforeAll, describe, expect, it, vi } from "vitest";
import type { handleEntitlementsRoute as handleEntitlementsRouteFn } from "../../../src/routes/api/entitlements";

const COLD_IMPORT_TIMEOUT_MS = 30_000;

let handleEntitlementsRoute: typeof handleEntitlementsRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));

const makeDependencies = (
  overrides: Record<string, unknown> = {},
) => ({
  getAccountCount: () => Promise.resolve(2),
  getAccountLimit: () => Number.POSITIVE_INFINITY,
  getFeedCount: () => Promise.resolve(1),
  getFeedLimit: () => Number.POSITIVE_INFINITY,
  getMappingCount: () => Promise.resolve(3),
  getMappingLimit: () => Number.POSITIVE_INFINITY,
  getUserPlan: () => Promise.resolve("pro" as const),
  webhookConfigured: true,
  ...overrides,
});

const readJson = (response: Response): Promise<Record<string, unknown>> =>
  response.json() as Promise<Record<string, unknown>>;

vi.mock("../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../src/context", () => ({
  database: {},
  premiumService: {},
  webhookConfig: null,
}));

beforeAll(async () => {
  ({ handleEntitlementsRoute } = await import("../../../src/routes/api/entitlements"));
}, COLD_IMPORT_TIMEOUT_MS);

describe("handleEntitlementsRoute realtimeSync", () => {
  it("is true only for a pro plan on a configured deployment", async () => {
    const response = await handleEntitlementsRoute({ userId: "user-1" }, makeDependencies());

    expect(await readJson(response)).toMatchObject({ plan: "pro", realtimeSync: true });
  });

  it("is false for a pro plan when the deployment has no public webhook url", async () => {
    const response = await handleEntitlementsRoute(
      { userId: "user-1" },
      makeDependencies({ webhookConfigured: false }),
    );

    expect(await readJson(response)).toMatchObject({ plan: "pro", realtimeSync: false });
  });

  it("is false for a free plan even on a configured deployment", async () => {
    const response = await handleEntitlementsRoute(
      { userId: "user-1" },
      makeDependencies({ getUserPlan: () => Promise.resolve("free" as const) }),
    );

    expect(await readJson(response)).toMatchObject({ plan: "free", realtimeSync: false });
  });

  it("keeps reporting the existing entitlement shape", async () => {
    const response = await handleEntitlementsRoute({ userId: "user-1" }, makeDependencies());

    expect(await readJson(response)).toEqual({
      accounts: { current: 2, limit: null },
      canCustomizeIcalFeed: true,
      canUseEventFilters: true,
      canUseTwoWaySync: true,
      feeds: { current: 1, limit: null },
      mappings: { current: 3, limit: null },
      plan: "pro",
      realtimeSync: true,
    });
  });
});

describe("handleEntitlementsRoute feeds", () => {
  it("reports the feed count and an unlimited pro allowance", async () => {
    const response = await handleEntitlementsRoute({ userId: "user-1" }, makeDependencies());

    expect(await readJson(response)).toMatchObject({
      feeds: { current: 1, limit: null },
    });
  });

  it("reports the finite free allowance", async () => {
    const response = await handleEntitlementsRoute({ userId: "user-1" }, makeDependencies({
      getFeedLimit: () => 1,
      getUserPlan: () => Promise.resolve("free" as const),
    }));

    expect(await readJson(response)).toMatchObject({
      feeds: { current: 1, limit: 1 },
    });
  });
});
