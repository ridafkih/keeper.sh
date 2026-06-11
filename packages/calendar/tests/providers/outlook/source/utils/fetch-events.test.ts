import { afterEach, describe, expect, it } from "vitest";
import { EventsFetchError, fetchCalendarEvents, parseOutlookEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { OutlookCalendarEvent } from "../../../../../src/providers/outlook/source/types";

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
      "id,iCalUId,subject,body,location,start,end,isAllDay,showAs,categories,type,seriesMasterId",
    );
  });

  it("hydrates recurring occurrences from a series master in the payload", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [
            createOutlookEvent({
              iCalUId: "series-uid-1",
              id: "master-1",
              showAs: "busy",
              subject: "Daily Standup",
              type: "seriesMaster",
            }),
            {
              end: { dateTime: "2026-06-09T10:15:00", timeZone: "UTC" },
              id: "occurrence-1",
              seriesMasterId: "master-1",
              start: { dateTime: "2026-06-09T10:00:00", timeZone: "UTC" },
              type: "occurrence",
            },
            {
              end: { dateTime: "2026-06-10T10:15:00", timeZone: "UTC" },
              id: "occurrence-2",
              seriesMasterId: "master-1",
              start: { dateTime: "2026-06-10T10:00:00", timeZone: "UTC" },
              type: "occurrence",
            },
            createOutlookEvent({
              iCalUId: "single-uid-1",
              id: "single-1",
              seriesMasterId: null,
              type: "singleInstance",
            }),
          ],
        }),
      ],
      requestedUrls,
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      timeMax: new Date("2026-06-16T00:00:00.000Z"),
      timeMin: new Date("2026-06-08T00:00:00.000Z"),
    });

    expect(fetchResult.fullSyncRequired).toBe(false);
    expect(requestedUrls).toHaveLength(1);
    expect(fetchResult.events.map((event) => event.id)).toEqual([
      "occurrence-1",
      "occurrence-2",
      "single-1",
    ]);

    const [firstOccurrence] = fetchResult.events;
    expect(firstOccurrence?.iCalUId).toBe("series-uid-1");
    expect(firstOccurrence?.subject).toBe("Daily Standup");
    expect(firstOccurrence?.showAs).toBe("busy");
    expect(firstOccurrence?.start?.dateTime).toBe("2026-06-09T10:00:00");
    expect(firstOccurrence?.end?.dateTime).toBe("2026-06-09T10:15:00");
  });

  it("fetches series masters missing from a delta payload", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [
            {
              end: { dateTime: "2026-06-09T10:15:00", timeZone: "UTC" },
              id: "occurrence-1",
              seriesMasterId: "master-1",
              start: { dateTime: "2026-06-09T10:00:00", timeZone: "UTC" },
              type: "occurrence",
            },
          ],
        }),
        createJsonResponse(
          createOutlookEvent({
            iCalUId: "series-uid-1",
            id: "master-1",
            subject: "Daily Standup",
            type: "seriesMaster",
          }),
        ),
      ],
      requestedUrls,
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=original",
    });

    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]).toContain("/me/events/master-1");
    expect(fetchResult.events).toHaveLength(1);
    expect(fetchResult.events[0]?.id).toBe("occurrence-1");
    expect(fetchResult.events[0]?.iCalUId).toBe("series-uid-1");
    expect(fetchResult.events[0]?.subject).toBe("Daily Standup");
    expect(fetchResult.events[0]?.start?.dateTime).toBe("2026-06-09T10:00:00");
  });

  it("skips occurrences whose series master no longer exists", async () => {
    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [
            {
              end: { dateTime: "2026-06-09T10:15:00", timeZone: "UTC" },
              id: "occurrence-1",
              seriesMasterId: "master-1",
              start: { dateTime: "2026-06-09T10:00:00", timeZone: "UTC" },
              type: "occurrence",
            },
          ],
        }),
        new Response(null, { status: 404 }),
      ],
      [],
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=original",
    });

    expect(fetchResult.events).toEqual([]);
  });

  it("keeps exception instances that already carry full properties", async () => {
    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [
            createOutlookEvent({
              iCalUId: "series-uid-1",
              id: "master-1",
              subject: "Daily Standup",
              type: "seriesMaster",
            }),
            createOutlookEvent({
              end: { dateTime: "2026-06-09T12:30:00", timeZone: "UTC" },
              iCalUId: "series-uid-1",
              id: "exception-1",
              seriesMasterId: "master-1",
              start: { dateTime: "2026-06-09T12:00:00", timeZone: "UTC" },
              subject: "Daily Standup (moved)",
              type: "exception",
            }),
          ],
        }),
      ],
      [],
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      timeMax: new Date("2026-06-16T00:00:00.000Z"),
      timeMin: new Date("2026-06-08T00:00:00.000Z"),
    });

    expect(fetchResult.events).toHaveLength(1);
    expect(fetchResult.events[0]?.id).toBe("exception-1");
    expect(fetchResult.events[0]?.subject).toBe("Daily Standup (moved)");
    expect(fetchResult.events[0]?.start?.dateTime).toBe("2026-06-09T12:00:00");
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
    globalThis.fetch = createFetchQueue([
      Response.json(
        { error: { code: "ErrorAccessDenied", message: "Access denied" } },
        { status: 403 },
      ),
    ], []);

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
      expect(error.message).toContain("Access denied");
      expect(error.apiError.code).toBe("ErrorAccessDenied");
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

  it("skips events marked with the keeper category", () => {
    const validEvent = createOutlookEvent({
      iCalUId: "external-uid-6",
      id: "outlook-event-id-6",
    });

    const keeperCategoryEvent = createOutlookEvent({
      categories: ["keeper.sh"],
      iCalUId: "external-uid-7",
      id: "outlook-event-id-7",
    });

    const parsedEvents = parseOutlookEvents([validEvent, keeperCategoryEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.uid).toBe("external-uid-6");
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
