import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedResponse } from "../../../../src/utils/ical-feed";

const generateUserCalendar =
  vi.fn<(identifier: string, ifNoneMatch: string | null) => Promise<FeedResponse | null>>();
const widelogSet = vi.fn<(key: string, value: unknown) => void>();

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/utils/ical", () => ({
  generateUserCalendar: (identifier: string, ifNoneMatch: string | null) =>
    generateUserCalendar(identifier, ifNoneMatch),
}));
vi.mock("../../../../src/utils/logging", () => ({
  context: {},
  destroy: () => null,
  widelog: {
    set: (key: string, value: unknown) => widelogSet(key, value),
    errorFields: () => null,
    flush: () => null,
  },
}));

type CalendarHandler = (context: {
  params: Record<string, string | undefined>;
  request: Request;
}) => Promise<Response>;

let serveFeed: CalendarHandler = () => Promise.reject(new Error("Module not loaded"));

const EMPTY_CALENDAR = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Keeper//Keeper Calendar//EN",
  "VERSION:2.0",
  "END:VCALENDAR",
].join("\r\n");

const FEED_TOKEN = `feed_${"a".repeat(64)}`;

const renderedFeed = (body: string): FeedResponse => ({
  body,
  etag: '"etag-1"',
  eventCount: 0,
  withheld: {
    allDay: 0,
    focusTime: 0,
    outOfOffice: 0,
    workingElsewhere: 0,
    workingLocation: 0,
  },
});

const requestFeed = (identifier: string | undefined): Promise<Response> =>
  serveFeed({
    params: { identifier },
    request: new Request("https://keeper.test/api/cal/feed.ics"),
  });

beforeAll(async () => {
  const module = await import("../../../../src/routes/api/cal/[identifier]") as unknown as {
    GET: CalendarHandler;
  };
  serveFeed = module.GET;
});

afterEach(() => {
  generateUserCalendar.mockReset();
  widelogSet.mockReset();
});

describe("GET /api/cal/:identifier", () => {
  it("still requires the .ics suffix", async () => {
    const response = await requestFeed("ada");

    expect(response.status).toBe(404);
    expect(generateUserCalendar).not.toHaveBeenCalled();
  });

  it("strips the suffix and resolves a legacy username unchanged", async () => {
    generateUserCalendar.mockResolvedValue(renderedFeed(EMPTY_CALENDAR));

    const response = await requestFeed("ada.ics");

    expect(generateUserCalendar).toHaveBeenCalledWith("ada", null);
    expect(response.status).toBe(200);
  });

  it("resolves an opaque feed token", async () => {
    generateUserCalendar.mockResolvedValue(renderedFeed(EMPTY_CALENDAR));

    await requestFeed(`${FEED_TOKEN}.ics`);

    expect(generateUserCalendar).toHaveBeenCalledWith(FEED_TOKEN, null);
  });

  it("returns 404 when the identifier resolves to no feed", async () => {
    generateUserCalendar.mockResolvedValue(null);

    const response = await requestFeed("nobody.ics");

    expect(response.status).toBe(404);
  });

  it("returns an empty but valid calendar rather than a 404 for a feed with no calendars", async () => {
    generateUserCalendar.mockResolvedValue(renderedFeed(EMPTY_CALENDAR));

    const response = await requestFeed(`${FEED_TOKEN}.ics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(body).not.toContain("BEGIN:VEVENT");
  });

  it("keeps the feed content type alongside the validator headers", async () => {
    generateUserCalendar.mockResolvedValue(renderedFeed(EMPTY_CALENDAR));

    const response = await requestFeed(`${FEED_TOKEN}.ics`);

    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("never records the feed token in the wide event", async () => {
    generateUserCalendar.mockResolvedValue(renderedFeed(EMPTY_CALENDAR));

    await requestFeed(`${FEED_TOKEN}.ics`);

    const entries = widelogSet.mock.calls;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContainEqual(["http.path", "/api/cal/:identifier"]);
    for (const [, value] of entries) {
      expect(JSON.stringify(value ?? null)).not.toContain(FEED_TOKEN);
    }
  });
});
