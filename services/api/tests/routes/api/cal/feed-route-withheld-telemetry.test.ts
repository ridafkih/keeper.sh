import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedResponse } from "../../../../src/utils/ical-feed";

const captured = vi.hoisted(() => ({
  setCalls: [] as [string, unknown][],
}));

const feedResponse = vi.hoisted(() => ({
  current: null as FeedResponse | null,
}));

vi.mock("../../../../src/utils/middleware", () => ({
  withWideEvent: (handler: unknown) => handler,
}));

vi.mock("../../../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    errorFields: () => null,
    flush: () => null,
    set: (key: string, value: unknown) => {
      captured.setCalls.push([key, value]);
    },
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));

vi.mock("../../../../src/utils/ical", () => ({
  generateUserCalendar: () => Promise.resolve(feedResponse.current),
}));

const RENDERED_FEED: FeedResponse = {
  body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  etag: '"etag-1"',
  eventCount: 4,
  withheld: { allDay: 1, focusTime: 5, outOfOffice: 6, workingElsewhere: 2, workingLocation: 3 },
};

const NOT_MODIFIED_FEED: FeedResponse = {
  body: null,
  etag: '"etag-1"',
  eventCount: 0,
  withheld: { allDay: 0, focusTime: 0, outOfOffice: 0, workingElsewhere: 0, workingLocation: 0 },
};

const requestFeed = async (): Promise<Response> => {
  const { GET } = await import("../../../../src/routes/api/cal/[identifier]");
  const handler = GET as unknown as (context: {
    params: Record<string, string>;
    request: Request;
  }) => Promise<Response>;
  return handler({
    params: { identifier: "feed-token.ics" },
    request: new Request("https://keeper.test/api/cal/feed-token.ics"),
  });
};

describe("feed route withheld telemetry", () => {
  beforeEach(() => {
    captured.setCalls = [];
  });

  it("records withheld counts by reason on the wide event for a rendered feed", async () => {
    feedResponse.current = RENDERED_FEED;

    const response = await requestFeed();

    expect(response.status).toBe(200);
    const fields = new Map(captured.setCalls);
    expect(fields.get("feed.withheld.working_location")).toBe(3);
    expect(fields.get("feed.withheld.working_elsewhere")).toBe(2);
    expect(fields.get("feed.withheld.all_day")).toBe(1);
    expect(fields.get("feed.withheld.focus_time")).toBe(5);
    expect(fields.get("feed.withheld.out_of_office")).toBe(6);
    expect(fields.get("feed.event_count")).toBe(4);
  });

  it("leaves withheld fields off the wide event when nothing was rendered", async () => {
    feedResponse.current = NOT_MODIFIED_FEED;

    const response = await requestFeed();

    expect(response.status).toBe(304);
    const keys = captured.setCalls.map(([key]) => key);
    expect(keys).not.toContain("feed.withheld.working_location");
    expect(keys).not.toContain("feed.withheld.working_elsewhere");
    expect(keys).not.toContain("feed.withheld.all_day");
    expect(keys).not.toContain("feed.withheld.focus_time");
    expect(keys).not.toContain("feed.withheld.out_of_office");
  });
});
