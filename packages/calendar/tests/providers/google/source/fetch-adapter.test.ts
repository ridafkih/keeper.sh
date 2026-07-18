import { afterEach, describe, expect, it } from "vitest";
import { getOAuthSyncTokenVersion } from "../../../../src/core/oauth/sync-window";
import {
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "../../../../src/core/oauth/sync-token";
import { createGoogleSourceFetcher } from "../../../../src/providers/google/source/fetch-adapter";

const SYNC_TOKEN_VERSION = getOAuthSyncTokenVersion();

const originalFetch = globalThis.fetch;

const fetchOutOfWindowGoogleDelta = (): Promise<Response> => Promise.resolve(Response.json({
  items: [{
    end: { dateTime: "2098-03-08T15:00:00.000Z", timeZone: "UTC" },
    iCalUID: "external-uid-1",
    id: "google-event-id-1",
    start: { dateTime: "2098-03-08T14:00:00.000Z", timeZone: "UTC" },
    status: "confirmed",
  }],
  nextSyncToken: "next-google-token",
}));
fetchOutOfWindowGoogleDelta.preconnect = originalFetch.preconnect;
const fetchGoogleDeltaWithoutSuccessor = (): Promise<Response> => Promise.resolve(Response.json({
  items: [{
    end: { dateTime: "2026-03-08T15:00:00.000Z", timeZone: "UTC" },
    iCalUID: "external-uid-1",
    id: "google-event-id-1",
    start: { dateTime: "2026-03-08T14:00:00.000Z", timeZone: "UTC" },
    status: "confirmed",
  }],
}));
fetchGoogleDeltaWithoutSuccessor.preconnect = originalFetch.preconnect;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createGoogleSourceFetcher", () => {
  it("returns a fetchEvents function that retrieves and parses Google Calendar events", () => {
    const fetcher = createGoogleSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "primary",
      syncToken: null,
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });

  it("returns a versioned token that the next cron run accepts", async () => {
    const rawSyncToken = "google-sync-token";
    const queuedFetch = (): Promise<Response> => Promise.resolve(Response.json({
      items: [],
      nextSyncToken: rawSyncToken,
    }));
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;
    const fetcher = createGoogleSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "primary",
      syncToken: null,
    });

    const result = await fetcher.fetchEvents();

    expect(result.nextSyncToken).not.toBe(rawSyncToken);
    expect(resolveSyncTokenForWindow(
      result.nextSyncToken ?? null,
      SYNC_TOKEN_VERSION,
    )).toEqual({
      requiresBackfill: false,
      syncToken: rawSyncToken,
    });
  });

  it("reports changed provider IDs without storing delta events outside the sync window", async () => {
    globalThis.fetch = fetchOutOfWindowGoogleDelta;
    const fetcher = createGoogleSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "primary",
      syncToken: encodeStoredSyncToken("current-google-token", SYNC_TOKEN_VERSION),
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.changedEventIds).toEqual(["google-event-id-1"]);
  });

  it("requests a full sync instead of replaying a delta with no successor token", async () => {
    globalThis.fetch = fetchGoogleDeltaWithoutSuccessor;

    const result = await createGoogleSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "primary",
      syncToken: encodeStoredSyncToken("current-google-token", SYNC_TOKEN_VERSION),
    }).fetchEvents();

    expect(result).toEqual({ events: [], fullSyncRequired: true });
  });
});
