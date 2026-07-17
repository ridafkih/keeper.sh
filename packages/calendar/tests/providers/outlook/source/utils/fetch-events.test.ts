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

const createOutlookEventVersion = (removed: boolean): OutlookCalendarEvent => ({
  ...(removed && { "@removed": { reason: "deleted" } }),
  iCalUId: "event-uid",
  id: "event-1",
  type: "singleInstance",
});

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
  requestedInits: RequestInit[] = [],
): typeof fetch => {
  let requestCount = 0;

  const queuedFetch = (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
    requestedUrls.push(resolveInputUrl(input));
    requestedInits.push(init ?? {});

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
  it("forces a full sync when paged delta data includes a sparse deletion tombstone", async () => {
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

    expect(fetchResult).toEqual({ events: [], fullSyncRequired: true });
    expect(requestedUrls).toEqual([initialDeltaLink, nextPageLink]);
  });

  it.each([
    {
      expectedCancelledIds: ["event-1"],
      expectedEventIds: [],
      firstRemoved: false,
      lastRemoved: true,
    },
    {
      expectedCancelledIds: [],
      expectedEventIds: ["event-1"],
      firstRemoved: true,
      lastRemoved: false,
    },
  ])("uses the final paged state when one provider event changes repeatedly", async ({
    expectedCancelledIds,
    expectedEventIds,
    firstRemoved,
    lastRemoved,
  }) => {
    const nextPageLink = "https://graph.microsoft.com/delta?$skiptoken=next";
    globalThis.fetch = createFetchQueue([
      createJsonResponse({
        "@odata.nextLink": nextPageLink,
        value: [createOutlookEventVersion(firstRemoved)],
      }),
      createJsonResponse({
        "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
        value: [createOutlookEventVersion(lastRemoved)],
      }),
    ], []);

    const result = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/delta?$deltatoken=current",
    });

    expect(result.events.map((event) => event.id)).toEqual(expectedEventIds);
    expect(result.changedEventIds).toEqual(["event-1"]);
    expect(result.cancelledEventIds).toEqual(expectedCancelledIds);
  });

  it.each([
    ["older page first", ["older", "newer"]],
    ["newer page first", ["newer", "older"]],
  ])("uses Outlook revision timestamps instead of page order when %s", async (_label, order) => {
    const revisions = {
      newer: {
        iCalUId: "event-uid",
        id: "event-1",
        lastModifiedDateTime: "2026-03-02T00:00:00.000Z",
        subject: "Newest",
      },
      older: {
        iCalUId: "event-uid",
        id: "event-1",
        lastModifiedDateTime: "2026-03-01T00:00:00.000Z",
        subject: "Stale",
      },
    };
    const orderedEvents = order.map((revision) => {
      if (revision === "older") {
        return revisions.older;
      }
      if (revision === "newer") {
        return revisions.newer;
      }
      throw new Error(`Unknown revision: ${revision}`);
    });
    const [firstEvent, secondEvent] = orderedEvents;
    if (!firstEvent || !secondEvent) {
      throw new Error("Expected two ordered revisions");
    }
    const nextPageLink = "https://graph.microsoft.com/delta?$skiptoken=next";
    globalThis.fetch = createFetchQueue([
      createJsonResponse({
        "@odata.nextLink": nextPageLink,
        value: [firstEvent],
      }),
      createJsonResponse({
        "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
        value: [secondEvent],
      }),
    ], []);

    const result = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/delta?$deltatoken=current",
    });

    expect(result.events).toMatchObject([{ id: "event-1", subject: "Newest" }]);
  });

  it("builds initial range URL when running full sync", async () => {
    const requestedUrls: string[] = [];
    const requestedInits: RequestInit[] = [];

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarView/delta?$deltatoken=final",
          value: [],
        }),
      ],
      requestedUrls,
      requestedInits,
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
    expect(parsedUrl.searchParams.get("$select")).toBeNull();
    expect(requestedInits[0]?.headers).toMatchObject({
      Prefer: expect.stringContaining(`outlook.body-content-type="text"`),
    });
  });

  it("expands an Outlook series master into all paged instances during full sync", async () => {
    const requestedUrls: string[] = [];
    const instancesNextLink = "https://graph.microsoft.com/v1.0/instances?$skiptoken=next";
    globalThis.fetch = createFetchQueue([
      createJsonResponse({
        "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
        value: [createOutlookEvent({
          end: { dateTime: "2024-01-01T11:00:00", timeZone: "UTC" },
          id: "master/id",
          start: { dateTime: "2024-01-01T10:00:00", timeZone: "UTC" },
          type: "seriesMaster",
        })],
      }),
      createJsonResponse({
        "@odata.nextLink": instancesNextLink,
        value: [createOutlookEvent({ id: "occurrence-1", type: "occurrence" })],
      }),
      createJsonResponse({
        value: [createOutlookEvent({ id: "occurrence-2", type: "exception" })],
      }),
    ], requestedUrls);

    const result = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar/id",
      timeMax: new Date("2026-07-31T00:00:00.000Z"),
      timeMin: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(result.events.map((event) => event.id)).toEqual(["occurrence-1", "occurrence-2"]);
    const instancesUrl = new URL(requestedUrls[1] ?? "");
    expect(instancesUrl.pathname).toContain(
      "/me/calendars/calendar%2Fid/events/master%2Fid/instances",
    );
    expect(instancesUrl.searchParams.get("startDateTime")).toBe("2026-07-01T00:00:00.000Z");
    expect(requestedUrls[2]).toBe(instancesNextLink);
  });

  it("forces an authoritative full sync when a delta page contains a series master", async () => {
    globalThis.fetch = createFetchQueue([createJsonResponse({
      "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
      value: [createOutlookEvent({ id: "master-1", type: "seriesMaster" })],
    })], []);

    await expect(fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/delta?$deltatoken=current",
    })).resolves.toEqual({ events: [], fullSyncRequired: true });
  });

  it("treats isCancelled delta events as deletions", async () => {
    globalThis.fetch = createFetchQueue([createJsonResponse({
      "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
      value: [createOutlookEvent({ id: "cancelled-1", isCancelled: true })],
    })], []);

    const result = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      deltaLink: "https://graph.microsoft.com/delta?$deltatoken=current",
    });

    expect(result.events).toEqual([]);
    expect(result.changedEventIds).toEqual(["cancelled-1"]);
    expect(result.cancelledEventIds).toEqual(["cancelled-1"]);
  });

  it("fails the full sync instead of silently dropping a series whose instances fail", async () => {
    globalThis.fetch = createFetchQueue([
      createJsonResponse({ value: [createOutlookEvent({ id: "master-1", type: "seriesMaster" })] }),
      new Response("instance failure", { status: 500 }),
    ], []);

    await expect(fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      timeMax: new Date("2026-07-31T00:00:00.000Z"),
      timeMin: new Date("2026-07-01T00:00:00.000Z"),
    })).rejects.toThrow("Failed to fetch events: 500: instance failure");
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
    expect(parsedEvent.sourceEventId).toBe("outlook-event-id-1");
    expect(parsedEvent.startTime.toISOString()).toBe("2026-03-08T14:00:00.000Z");
    expect(parsedEvent.endTime.toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(parsedEvent.startTimeZone).toBe("Etc/UTC");
  });

  it("interprets Microsoft wall times in their Windows timezone", () => {
    const parsedEvents = parseOutlookEvents([createOutlookEvent({
      end: {
        dateTime: "2026-03-02T10:00:00",
        timeZone: "Mountain Standard Time",
      },
      start: {
        dateTime: "2026-03-02T09:00:00",
        timeZone: "Mountain Standard Time",
      },
    })]);

    expect(parsedEvents[0]?.startTime.toISOString()).toBe("2026-03-02T16:00:00.000Z");
    expect(parsedEvents[0]?.endTime.toISOString()).toBe("2026-03-02T17:00:00.000Z");
    expect(parsedEvents[0]?.startTimeZone).toBe("America/Denver");
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
