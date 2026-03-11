import { afterEach, describe, expect, it } from "bun:test";
import { EventsFetchError, fetchCalendarEvents, parseOutlookEvents } from "./fetch-events";
import type { OutlookCalendarEvent } from "../types";

const createOutlookEvent = (
  overrides: Partial<OutlookCalendarEvent>,
): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-03-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: "external-uid-1",
  id: "outlook-event-id-1",
  start: {
    dateTime: "2026-03-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
  ...overrides,
});

const originalFetch = globalThis.fetch;

const resolveInputUrl = (input: Request | URL | string): string => {
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof input === "string") {
    return input;
  }
  return input.url;
};

const createJsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const createFetchQueue = (
  queuedResponses: Response[],
  requestedUrls: string[],
): typeof fetch => {
  let requestCount = 0;

  const queuedFetch = (input: Request | URL | string): Promise<Response> => {
    requestedUrls.push(resolveInputUrl(input));

    const nextResponse = queuedResponses[requestCount];
    requestCount += 1;

    if (!nextResponse) {
      throw new Error("Unexpected fetch invocation");
    }

    return Promise.resolve(nextResponse);
  };

  queuedFetch.preconnect = originalFetch.preconnect;
  return queuedFetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchCalendarEvents", () => {
  it("collects paged events and removals during delta sync", async () => {
    const requestedUrls: string[] = [];

    const initialDeltaLink = "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=original";
    const nextPageLink = "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$skiptoken=next-page";

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=first",
          "@odata.nextLink": nextPageLink,
          value: [
            { iCalUId: "ext-uid-1", id: "event-1" },
            { "@removed": { reason: "deleted" }, iCalUId: "removed-uid", id: "event-2" },
          ],
        }),
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [
            { "@removed": { reason: "deleted" }, id: "removed-by-id" },
            { iCalUId: "ext-uid-2", id: "event-3" },
          ],
        }),
      ],
      requestedUrls,
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: initialDeltaLink,
    });

    expect(fetchResult.fullSyncRequired).toBe(false);
    expect(fetchResult.isDeltaSync).toBe(true);
    expect(fetchResult.nextDeltaLink).toContain("deltatoken=final");
    expect(fetchResult.events.map((event) => event.id)).toEqual(["event-1", "event-3"]);
    expect(fetchResult.cancelledEventUids).toEqual(["removed-uid", "removed-by-id"]);
    expect(requestedUrls).toEqual([initialDeltaLink, nextPageLink]);
  });

  it("builds initial range URL when running full sync", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [],
        }),
      ],
      requestedUrls,
    );

    await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar/id:with chars",
      timeMax: new Date("2026-06-02T00:00:00.000Z"),
      timeMin: new Date("2026-06-01T00:00:00.000Z"),
    });

    const [firstRequestUrl] = requestedUrls;
    if (!firstRequestUrl) {
      throw new Error("Expected first request URL");
    }

    const parsedUrl = new URL(firstRequestUrl);
    expect(parsedUrl.pathname).toContain(
      "/me/calendars/calendar%2Fid%3Awith%20chars/calendarView/delta",
    );
    expect(parsedUrl.searchParams.get("startDateTime")).toBe("2026-06-01T00:00:00.000Z");
    expect(parsedUrl.searchParams.get("endDateTime")).toBe("2026-06-02T00:00:00.000Z");
    expect(parsedUrl.searchParams.get("$select")).toBe(
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs",
    );
  });

  it("returns full-sync-required when Microsoft responds with gone", async () => {
    globalThis.fetch = createFetchQueue([new Response(null, { status: 410 })], []);

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=original",
    });

    expect(fetchResult).toEqual({ events: [], fullSyncRequired: true });
  });

  it("throws auth-required error details on forbidden response", async () => {
    globalThis.fetch = createFetchQueue([new Response(null, { status: 403 })], []);

    try {
      await fetchCalendarEvents({
        accessToken: "token",
        calendarId: "calendar-id",
        deltaLink: "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=original",
      });
      throw new Error("Expected fetchCalendarEvents to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EventsFetchError);

      if (!(error instanceof EventsFetchError)) {
        throw error;
      }

      expect(error.status).toBe(403);
      expect(error.authRequired).toBe(true);
      expect(error.message).toContain("Failed to fetch events: 403");
    }
  });
});

describe("parseOutlookEvents", () => {
  it("parses valid events and normalizes UTC date strings", () => {
    const parsedEvents = parseOutlookEvents([createOutlookEvent({})]);

    expect(parsedEvents).toHaveLength(1);

    const [parsedEvent] = parsedEvents;
    if (!parsedEvent) {
      throw new Error("Expected parsed event");
    }

    expect(parsedEvent.uid).toBe("external-uid-1");
    expect(parsedEvent.startTime.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(parsedEvent.endTime.toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(parsedEvent.startTimeZone).toBe("UTC");
  });

  it("skips keeper-managed and malformed events", () => {
    const validEvent = createOutlookEvent({
      iCalUId: "external-uid-2",
      id: "outlook-event-id-2",
    });
    const keeperEvent = createOutlookEvent({
      iCalUId: "internal-event@keeper.sh",
      id: "outlook-event-id-3",
    });
    const malformedEvent = createOutlookEvent({
      end: { dateTime: "2026-03-08T15:00:00" },
      iCalUId: "external-uid-3",
      id: "outlook-event-id-4",
      start: { dateTime: "2026-03-08T14:00:00", timeZone: "UTC" },
    });

    const parsedEvents = parseOutlookEvents([validEvent, keeperEvent, malformedEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.uid).toBe("external-uid-2");
  });

  it("preserves working elsewhere availability", () => {
    const parsedEvents = parseOutlookEvents([
      createOutlookEvent({
        iCalUId: "external-uid-4",
        showAs: "workingElsewhere",
      }),
    ]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.availability).toBe("workingElsewhere");
  });

  it("preserves free availability", () => {
    const parsedEvents = parseOutlookEvents([
      createOutlookEvent({
        iCalUId: "external-uid-5",
        showAs: "free",
      }),
    ]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.availability).toBe("free");
  });
});
