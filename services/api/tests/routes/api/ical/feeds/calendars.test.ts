import { describe, expect, it, vi } from "vitest";
import {
  handleGetFeedCalendarsRoute,
  handlePutFeedCalendarsRoute,
} from "../../../../../src/routes/api/ical/feeds/[id]/calendars";
import { FeedNotFoundError } from "../../../../../src/utils/ical-feeds";

vi.mock("../../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../../src/context", () => ({
  baseUrl: "https://keeper.sh",
  database: {},
  premiumService: {},
}));

describe("handlePutFeedCalendarsRoute", () => {
  it("rejects a body that is not a calendar id array", async () => {
    const writes: string[][] = [];

    const response = await handlePutFeedCalendarsRoute(
      { body: { calendarIds: "calendar-a" }, params: { id: "feed-1" }, userId: "user-1" },
      {
        setFeedCalendars: (_userId, _feedId, calendarIds) => {
          writes.push(calendarIds);
          return Promise.resolve();
        },
      },
    );

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it("stores the selection scoped to the calling user and the path feed", async () => {
    const writes: [string, string, string[]][] = [];

    const response = await handlePutFeedCalendarsRoute(
      {
        body: { calendarIds: ["calendar-a", "calendar-b"] },
        params: { id: "feed-work" },
        userId: "user-1",
      },
      {
        setFeedCalendars: (userId, feedId, calendarIds) => {
          writes.push([userId, feedId, calendarIds]);
          return Promise.resolve();
        },
      },
    );

    expect(response.status).toBeLessThan(300);
    expect(writes).toEqual([["user-1", "feed-work", ["calendar-a", "calendar-b"]]]);
  });

  it("returns 404 when the feed belongs to someone else", async () => {
    const rejection = new FeedNotFoundError("Feed not found");

    const response = await handlePutFeedCalendarsRoute(
      { body: { calendarIds: [] }, params: { id: "feed-of-user-1" }, userId: "user-2" },
      { setFeedCalendars: () => Promise.reject(rejection) },
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when a calendar belongs to someone else", async () => {
    const response = await handlePutFeedCalendarsRoute(
      {
        body: { calendarIds: ["calendar-of-user-2"] },
        params: { id: "feed-work" },
        userId: "user-1",
      },
      { setFeedCalendars: () => Promise.reject(new Error("Some calendars not found")) },
    );

    expect(response.status).toBe(404);
  });
});

describe("handleGetFeedCalendarsRoute", () => {
  it("returns the selection for a feed the caller owns", async () => {
    const response = await handleGetFeedCalendarsRoute(
      { params: { id: "feed-work" }, userId: "user-1" },
      { getFeedCalendars: () => Promise.resolve(["calendar-a"]) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ calendarIds: ["calendar-a"] });
  });

  it("returns 404 for a feed the caller does not own", async () => {
    const response = await handleGetFeedCalendarsRoute(
      { params: { id: "feed-of-user-1" }, userId: "user-2" },
      { getFeedCalendars: () => Promise.resolve(null) },
    );

    expect(response.status).toBe(404);
  });
});
