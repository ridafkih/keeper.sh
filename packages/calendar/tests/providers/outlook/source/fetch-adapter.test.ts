import { afterEach, describe, expect, it } from "vitest";
import { OAUTH_SYNC_WINDOW_VERSION } from "../../../../src/core/oauth/sync-window";
import { resolveSyncTokenForWindow } from "../../../../src/core/oauth/sync-token";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";

const OUTLOOK_SYNC_TOKEN_VERSION = OAUTH_SYNC_WINDOW_VERSION + 1;
const originalFetch = globalThis.fetch;

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
});
