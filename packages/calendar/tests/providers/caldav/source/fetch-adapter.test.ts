import { describe, expect, it } from "bun:test";

describe("createCalDAVSourceFetcher", () => {
  it("returns a fetchEvents function", async () => {
    const { createCalDAVSourceFetcher } = await import("../../../../src/providers/caldav/source/fetch-adapter");

    const fetcher = createCalDAVSourceFetcher({
      calendarUrl: "https://caldav.example.com/calendar/",
      serverUrl: "https://caldav.example.com",
      username: "user",
      password: "pass",
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });
});
