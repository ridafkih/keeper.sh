import { afterEach, describe, expect, it } from "vitest";
import { OAUTH_SYNC_WINDOW_VERSION } from "../../../../src/core/oauth/sync-window";
import {
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "../../../../src/core/oauth/sync-token";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";

const OUTLOOK_SYNC_TOKEN_VERSION = OAUTH_SYNC_WINDOW_VERSION + 1;
const originalFetch = globalThis.fetch;
const fetchKeeperCategoryDelta = (): Promise<Response> => Promise.resolve(Response.json({
  "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
  value: [{
    categories: ["keeper.sh"],
    end: { dateTime: "2027-03-08T15:00:00.000Z", timeZone: "UTC" },
    iCalUId: "external-uid-1",
    id: "outlook-event-id-1",
    start: { dateTime: "2027-03-08T14:00:00.000Z", timeZone: "UTC" },
  }],
}));
fetchKeeperCategoryDelta.preconnect = originalFetch.preconnect;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createOutlookSourceFetcher", () => {
  it("returns a fetchEvents function", () => {
    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "calendar-id",
      syncToken: null,
    });

    expect(typeof fetcher.fetchEvents).toBe("function");
  });

  it("returns a versioned delta link that the next cron run accepts", async () => {
    const rawDeltaLink = "https://graph.microsoft.com/delta?$deltatoken=next";
    const queuedFetch = (): Promise<Response> => Promise.resolve(Response.json({
      "@odata.deltaLink": rawDeltaLink,
      value: [],
    }));
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;
    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "calendar-id",
      syncToken: null,
    });

    const result = await fetcher.fetchEvents();

    expect(result.nextSyncToken).not.toBe(rawDeltaLink);
    expect(resolveSyncTokenForWindow(
      result.nextSyncToken ?? null,
      OUTLOOK_SYNC_TOKEN_VERSION,
    )).toEqual({
      requiresBackfill: false,
      syncToken: rawDeltaLink,
    });
  });

  it("reports changed provider IDs without storing delta events outside the sync window", async () => {
    const nextDeltaLink = "https://graph.microsoft.com/delta?$deltatoken=next";
    const queuedFetch = (): Promise<Response> => Promise.resolve(Response.json({
      "@odata.deltaLink": nextDeltaLink,
      value: [{
        end: { dateTime: "2098-03-08T15:00:00.000Z", timeZone: "UTC" },
        iCalUId: "external-uid-1",
        id: "outlook-event-id-1",
        start: { dateTime: "2098-03-08T14:00:00.000Z", timeZone: "UTC" },
      }],
    }));
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;
    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "calendar-id",
      syncToken: encodeStoredSyncToken(
        "https://graph.microsoft.com/delta?$deltatoken=current",
        OUTLOOK_SYNC_TOKEN_VERSION,
      ),
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.changedEventIds).toEqual(["outlook-event-id-1"]);
  });

  it("reports raw changed IDs for delta events excluded during parsing", async () => {
    globalThis.fetch = fetchKeeperCategoryDelta;
    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      externalCalendarId: "calendar-id",
      syncToken: encodeStoredSyncToken(
        "https://graph.microsoft.com/delta?$deltatoken=current",
        OUTLOOK_SYNC_TOKEN_VERSION,
      ),
    });

    const result = await fetcher.fetchEvents();

    expect(result.events).toEqual([]);
    expect(result.changedEventIds).toEqual(["outlook-event-id-1"]);
  });
});
