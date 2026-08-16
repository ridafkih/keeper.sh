import { beforeAll, describe, expect, it, vi } from "vitest";
import type { handlePatchIcalSettingsRoute as handlePatchIcalSettingsRouteFn } from "../../../../src/routes/api/ical/settings";

const COLD_IMPORT_TIMEOUT_MS = 30_000;

let handlePatchIcalSettingsRoute: typeof handlePatchIcalSettingsRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));

const readJson = (response: Response): Promise<unknown> => response.json();

beforeAll(async () => {
  vi.mock("../../../../src/utils/middleware", () => ({
    withAuth: (handler: unknown) => handler,
    withWideEvent: (handler: unknown) => handler,
  }));
  vi.mock("../../../../src/context", () => ({
    database: {},
    premiumService: {},
  }));

  ({ handlePatchIcalSettingsRoute } = await import("../../../../src/routes/api/ical/settings"));
}, COLD_IMPORT_TIMEOUT_MS);

describe("handlePatchIcalSettingsRoute", () => {
  it("returns 403 when free users customize iCal feed settings", async () => {
    const response = await handlePatchIcalSettingsRoute(
      {
        body: { includeEventDescription: true },
        userId: "user-1",
      },
      {
        canCustomizeIcalFeed: () => Promise.resolve(false),
        ensureDefaultFeed: () => Promise.reject(new Error("must not resolve a feed")),
        updateFeedSettings: () => Promise.reject(new Error("must not write feed settings")),
        upsertSettings: () => Promise.reject(new Error("must not mirror legacy settings")),
      },
    );

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      error: "iCal feed customization requires a Pro plan.",
    });
  });

  it("persists valid updates when customization is allowed", async () => {
    const response = await handlePatchIcalSettingsRoute(
      {
        body: { includeEventDescription: true },
        userId: "user-1",
      },
      {
        canCustomizeIcalFeed: () => Promise.resolve(true),
        ensureDefaultFeed: () => Promise.resolve({ id: "feed-default" }),
        updateFeedSettings: (_feedId, updates) => Promise.resolve({
          customEventName: "Busy",
          excludeAllDayEvents: false,
          id: "settings-1",
          includeEventDescription: updates.includeEventDescription,
          includeEventLocation: false,
          includeEventName: false,
          userId: "user-1",
        }),
        upsertSettings: () => Promise.resolve(null),
      },
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      customEventName: "Busy",
      excludeAllDayEvents: false,
      id: "settings-1",
      includeEventDescription: true,
      includeEventLocation: false,
      includeEventName: false,
      userId: "user-1",
    });
  });
});

const makeRewiredDependencies = () => {
  const calls: string[] = [];
  const targetedFeedIds: string[] = [];
  const mirrored: Record<string, unknown>[] = [];
  return {
    calls,
    targetedFeedIds,
    mirrored,
    dependencies: {
      canCustomizeIcalFeed: () => Promise.resolve(true),
      ensureDefaultFeed: () => {
        calls.push("ensureDefaultFeed");
        return Promise.resolve({ id: "feed-default" });
      },
      updateFeedSettings: (feedId: string, updates: Record<string, unknown>) => {
        calls.push("updateFeedSettings");
        targetedFeedIds.push(feedId);
        return Promise.resolve({ id: "settings-1", userId: "user-1", ...updates });
      },
      upsertSettings: (_userId: string, updates: Record<string, unknown>) => {
        calls.push("upsertSettings");
        mirrored.push(updates);
        return Promise.resolve(updates);
      },
    },
  };
};

describe("handlePatchIcalSettingsRoute default feed rewiring", () => {
  it("materializes the default feed before patching it", async () => {
    const { calls, targetedFeedIds, dependencies } = makeRewiredDependencies();

    const response = await handlePatchIcalSettingsRoute(
      { body: { includeEventName: true }, userId: "user-1" },
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(calls.indexOf("ensureDefaultFeed"))
      .toBeLessThan(calls.indexOf("updateFeedSettings"));
    expect(targetedFeedIds).toEqual(["feed-default"]);
  });

  it("mirrors the shared columns into the legacy settings row", async () => {
    const { mirrored, dependencies } = makeRewiredDependencies();

    await handlePatchIcalSettingsRoute(
      { body: { includeEventName: true, customEventName: "Away" }, userId: "user-1" },
      dependencies,
    );

    expect(mirrored).toEqual([{ includeEventName: true, customEventName: "Away" }]);
  });
});
