import { afterEach, describe, expect, it } from "vitest";
import { EventsFetchError, fetchCalendarEvents, parseGoogleEvents } from "../../../../../src/providers/google/source/utils/fetch-events";
import type { GoogleCalendarEvent } from "../../../../../src/providers/google/source/types";

const createGoogleEvent = (overrides: Partial<GoogleCalendarEvent>): GoogleCalendarEvent => ({
  end: {
    dateTime: "2026-03-08T15:00:00.000Z",
    timeZone: "America/Toronto",
  },
  iCalUID: "external-uid-1",
  id: "google-event-id-1",
  start: {
    dateTime: "2026-03-08T14:00:00.000Z",
    timeZone: "America/Toronto",
  },
  status: "confirmed",
  summary: "Planning Session",
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
  it("collects paged events and cancelled UIDs during delta sync", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createFetchQueue(
      [
        createJsonResponse({
          items: [
            { iCalUID: "ext-uid-1", id: "event-1", status: "confirmed" },
            { iCalUID: "cancelled-uid", id: "event-2", status: "cancelled" },
          ],
          nextPageToken: "next-page-token",
          nextSyncToken: "sync-token-1",
        }),
        createJsonResponse({
          items: [
            { id: "cancelled-by-id", status: "cancelled" },
            { iCalUID: "ext-uid-2", id: "event-3", status: "confirmed" },
          ],
          nextSyncToken: "sync-token-2",
        }),
      ],
      requestedUrls,
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      syncToken: "existing-sync-token",
    });

    expect(fetchResult.fullSyncRequired).toBe(false);
    expect(fetchResult.isDeltaSync).toBe(true);
    expect(fetchResult.nextSyncToken).toBe("sync-token-2");
    expect(fetchResult.events.map((event) => event.id)).toEqual(["event-1", "event-3"]);
    expect(fetchResult.cancelledEventUids).toEqual(["cancelled-uid", "cancelled-by-id"]);
    expect(requestedUrls).toHaveLength(2);

    const [firstRequestUrl] = requestedUrls;
    if (!firstRequestUrl) {
      throw new Error("Expected first request URL");
    }

    const firstRequestSearchParams = new URL(firstRequestUrl).searchParams;
    expect(firstRequestSearchParams.get("syncToken")).toBe("existing-sync-token");
    expect(firstRequestSearchParams.get("timeMin")).toBeNull();
    expect(firstRequestSearchParams.get("timeMax")).toBeNull();
    expect(firstRequestSearchParams.get("maxResults")).toBe("250");
    expect(firstRequestSearchParams.get("pageToken")).toBeNull();

    const [, secondRequestUrl] = requestedUrls;
    if (!secondRequestUrl) {
      throw new Error("Expected second request URL");
    }

    const secondRequestSearchParams = new URL(secondRequestUrl).searchParams;
    expect(secondRequestSearchParams.get("pageToken")).toBe("next-page-token");
  });

  it("returns full-sync-required when Google responds with gone", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = createFetchQueue(
      [new Response(null, { status: 410 })],
      requestedUrls,
    );

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: "calendar-id",
      syncToken: "existing-sync-token",
    });

    expect(fetchResult).toEqual({ events: [], fullSyncRequired: true });
    expect(requestedUrls).toHaveLength(1);
  });

  it("throws auth-required error details on unauthorized response", async () => {
    const errorBody = JSON.stringify({
      error: {
        code: 401,
        message: "Request is missing required authentication credential.",
        status: "UNAUTHENTICATED",
        errors: [{ reason: "authError" }],
      },
    });
    globalThis.fetch = createFetchQueue([
      new Response(errorBody, { status: 401, headers: { "Content-Type": "application/json" } }),
    ], []);

    try {
      await fetchCalendarEvents({
        accessToken: "token",
        calendarId: "calendar-id",
        syncToken: "existing-sync-token",
      });
      throw new Error("Expected fetchCalendarEvents to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EventsFetchError);

      if (!(error instanceof EventsFetchError)) {
        throw error;
      }

      expect(error.status).toBe(401);
      expect(error.authRequired).toBe(true);
      expect(error.message).toContain("Failed to fetch events: 401");
    }
  });
});

describe("parseGoogleEvents", () => {
  it("filters keeper events and keeps typed Google events for later reconciliation", () => {
    const externalEvent = createGoogleEvent({ iCalUID: "external-uid-1" });
    const keeperEvent = createGoogleEvent({
      iCalUID: "generated-event@keeper.sh",
      id: "google-event-id-2",
    });
    const focusTimeEvent = createGoogleEvent({
      eventType: "focusTime",
      iCalUID: "external-uid-2",
      id: "google-event-id-3",
    });

    const parsedEvents = parseGoogleEvents([externalEvent, keeperEvent, focusTimeEvent]);

    expect(parsedEvents).toHaveLength(2);
    expect(parsedEvents[0]?.uid).toBe("external-uid-1");
    expect(parsedEvents[1]?.sourceEventType).toBe("focusTime");
  });

  it("uses end timezone when start timezone is absent", () => {
    const googleEvent = createGoogleEvent({
      end: {
        dateTime: "2026-03-08T15:00:00.000Z",
        timeZone: "America/Vancouver",
      },
      iCalUID: "external-uid-4",
      start: {
        dateTime: "2026-03-08T14:00:00.000Z",
      },
    });

    const parsedEvents = parseGoogleEvents([googleEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.startTimeZone).toBe("America/Vancouver");
  });

  it("marks working location events as working elsewhere", () => {
    const googleEvent = createGoogleEvent({
      eventType: "workingLocation",
      iCalUID: "external-uid-5",
    });

    const parsedEvents = parseGoogleEvents([googleEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.availability).toBe("workingElsewhere");
    expect(parsedEvents[0]?.sourceEventType).toBe("workingLocation");
  });

  it("marks transparent events as free", () => {
    const googleEvent = createGoogleEvent({
      iCalUID: "external-uid-6",
      transparency: "transparent",
    });

    const parsedEvents = parseGoogleEvents([googleEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.availability).toBe("free");
  });

  it("defaults regular events to busy availability", () => {
    const googleEvent = createGoogleEvent({
      iCalUID: "external-uid-7",
    });

    const parsedEvents = parseGoogleEvents([googleEvent]);

    expect(parsedEvents).toHaveLength(1);
    expect(parsedEvents[0]?.availability).toBe("busy");
  });
});
