import { beforeAll, describe, expect, it, vi } from "vitest";
import type { handlePatchIcalSettingsRoute as handlePatchIcalSettingsRouteFn } from "../../../../src/routes/api/ical/settings";

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
});

describe("handlePatchIcalSettingsRoute", () => {
  it("returns 403 when free users customize iCal feed settings", async () => {
    const response = await handlePatchIcalSettingsRoute(
      {
        body: { includeEventDescription: true },
        userId: "user-1",
      },
      {
        canCustomizeIcalFeed: () => Promise.resolve(false),
        upsertSettings: () => Promise.resolve(null),
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
        upsertSettings: (_userId, updates) => Promise.resolve({
          customEventName: "Busy",
          excludeAllDayEvents: false,
          id: "settings-1",
          includeEventDescription: updates.includeEventDescription,
          includeEventLocation: false,
          includeEventName: false,
          userId: "user-1",
        }),
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
