import { describe, expect, it } from "bun:test";

describe("createOutlookSourceFetcher", () => {
  it("returns a fetchEvents function", async () => {
    const { createOutlookSourceFetcher } = await import("../../../../src/providers/outlook/source/fetch-adapter");

    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "calendar-id",
      syncToken: null,
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });
});
