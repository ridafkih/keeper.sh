import { describe, expect, it } from "vitest";

describe("createIcsSourceFetcher", () => {
  it("returns a fetchEvents function", async () => {
    const { createIcsSourceFetcher } = await import("../../../src/ics/utils/fetch-adapter");

    const fetcher = createIcsSourceFetcher({
      calendarId: "test-calendar-id",
      url: "https://example.com/calendar.ics",
      database: {} as never,
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });
});
