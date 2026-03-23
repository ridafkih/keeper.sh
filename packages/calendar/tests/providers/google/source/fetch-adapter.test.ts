import { describe, expect, it } from "bun:test";

describe("createGoogleSourceFetcher", () => {
  it("returns a fetchEvents function that retrieves and parses Google Calendar events", async () => {
    const { createGoogleSourceFetcher } = await import("../../../../src/providers/google/source/fetch-adapter");

    const fetcher = createGoogleSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "primary",
      syncToken: null,
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });
});
