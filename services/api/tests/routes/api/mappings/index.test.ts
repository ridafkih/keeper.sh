import { beforeAll, describe, expect, it, vi } from "vitest";
import type { handleMappingsRoute as handleMappingsRouteFn } from "../../../../src/routes/api/mappings";

let handleMappingsRoute: typeof handleMappingsRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/utils/source-destination-mappings", () => ({
  getUserMappings: () => Promise.resolve([]),
}));

beforeAll(async () => {
  ({ handleMappingsRoute } = await import("../../../../src/routes/api/mappings"));
});

describe("handleMappingsRoute", () => {
  it("lists only which calendar copies into which", async () => {
    const response = await handleMappingsRoute({ userId: "user-1" }, {
      listMappings: () => Promise.resolve([{
        calendarType: "oauth",
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
        destinationCalendarId: "personal",
        id: "mapping-1",
        sourceCalendarId: "work",
      }]),
    });

    expect(await response.json()).toEqual({
      mappings: [{ destinationCalendarId: "personal", sourceCalendarId: "work" }],
    });
  });
});
