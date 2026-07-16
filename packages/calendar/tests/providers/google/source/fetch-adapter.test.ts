import { afterEach, describe, expect, it } from "vitest";
import { OAUTH_SYNC_WINDOW_VERSION } from "../../../../src/core/oauth/sync-window";
import { resolveSyncTokenForWindow } from "../../../../src/core/oauth/sync-token";
import { createGoogleSourceFetcher } from "../../../../src/providers/google/source/fetch-adapter";

const originalFetch = globalThis.fetch;

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
      OAUTH_SYNC_WINDOW_VERSION,
    )).toEqual({
      requiresBackfill: false,
      syncToken: rawSyncToken,
    });
  });
});
