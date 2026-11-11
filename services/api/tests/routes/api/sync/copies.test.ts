import { beforeAll, describe, expect, it, vi } from "vitest";
import type { handleCopiesRoute as handleCopiesRouteFn } from "../../../../src/routes/api/sync/copies";

let handleCopiesRoute: typeof handleCopiesRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));

const loggedFields = new Map<string, unknown>();

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/utils/logging", () => ({
  widelog: { set: (key: string, value: unknown) => loggedFields.set(key, value) },
}));
vi.mock("../../../../src/context", () => ({ database: {} }));

beforeAll(async () => {
  ({ handleCopiesRoute } = await import("../../../../src/routes/api/sync/copies"));
});

describe("handleCopiesRoute", () => {
  it("returns the user's copied event count and the next copies, and logs the count", async () => {
    const requests: [string, number][] = [];
    const response = await handleCopiesRoute({ userId: "user-1" }, {
      getCopiedEvents: (userId, limit) => {
        requests.push([userId, limit]);
        return Promise.resolve({
          count: 24,
          upcoming: [{
            destinationCalendarId: "destination-1",
            id: "copy-1",
            sourceCalendarId: "source-1",
            startTime: "2026-11-02T16:30:00.000Z",
            title: "Team standup",
          }],
        });
      },
    });

    expect(requests).toEqual([["user-1", 4]]);
    expect(await response.json()).toEqual({
      count: 24,
      upcoming: [{
        destinationCalendarId: "destination-1",
        id: "copy-1",
        sourceCalendarId: "source-1",
        startTime: "2026-11-02T16:30:00.000Z",
        title: "Team standup",
      }],
    });
    expect(loggedFields.get("sync.events_copied")).toBe(24);
  });
});
