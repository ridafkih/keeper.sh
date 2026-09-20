import { afterEach, describe, expect, it } from "vitest";
import { getOAuthSyncTokenVersion } from "../../../../src/core/oauth/sync-window";
import {
  encodeStoredSyncToken,
  resolveSyncTokenForWindow,
} from "../../../../src/core/oauth/sync-token";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";
import { clearMasterCategoryColorsCache } from "../../../../src/providers/outlook/source/utils/fetch-master-categories";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const CALENDAR_ID = "calendar-id";
const OUTLOOK_SYNC_TOKEN_VERSION = getOAuthSyncTokenVersion(1, new Date(), CALENDAR_ID);
const TEST_PLAN = createSourceIngestionPlan("1_week", "2_years");
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
const fetchSeriesMasterDelta = (): Promise<Response> => Promise.resolve(Response.json({
  "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
  value: [{ id: "series-master-1", type: "seriesMaster" }],
}));
fetchSeriesMasterDelta.preconnect = originalFetch.preconnect;
const fetchOutlookDeltaWithoutSuccessor = (): Promise<Response> => Promise.resolve(Response.json({
  value: [{
    end: { dateTime: "2026-03-08T15:00:00.000Z", timeZone: "UTC" },
    iCalUId: "external-uid-1",
    id: "outlook-event-id-1",
    start: { dateTime: "2026-03-08T14:00:00.000Z", timeZone: "UTC" },
  }],
}));
fetchOutlookDeltaWithoutSuccessor.preconnect = originalFetch.preconnect;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearMasterCategoryColorsCache();
});

describe("createOutlookSourceFetcher", () => {
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
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
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

  it.each([
    { categoriesResponse: () => Response.json({}, { status: 403 }), color: globalThis.undefined, unresolved: true },
    {
      categoriesResponse: () => Response.json({ value: [{ color: "preset7", displayName: "Work" }] }),
      color: "#5ca9e5",
      unresolved: globalThis.undefined,
    },
  ])("flags event colors as unresolved only when the category lookup fails", async (scenario) => {
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const queuedFetch = (input: Request | URL | string): Promise<Response> => {
      if (String(input).includes("masterCategories")) {
        return Promise.resolve(scenario.categoriesResponse());
      }
      return Promise.resolve(Response.json({
        "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
        value: [{
          categories: ["Work"],
          end: { dateTime: end.toISOString(), timeZone: "UTC" },
          iCalUId: "external-uid-1",
          id: "outlook-event-id-1",
          start: { dateTime: start.toISOString(), timeZone: "UTC" },
        }],
      }));
    };
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;

    const result = await createOutlookSourceFetcher({
      accessToken: "test-token",
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
      externalCalendarId: "calendar-id",
      syncToken: null,
    }).fetchEvents();

    expect(result.eventColorsUnresolved).toBe(scenario.unresolved);
    expect(result.events[0]?.color).toBe(scenario.color);
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
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
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
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
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

  it("requests a full backfill when Graph returns a series master during delta sync", async () => {
    globalThis.fetch = fetchSeriesMasterDelta;
    const fetcher = createOutlookSourceFetcher({
      accessToken: "test-token",
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
      externalCalendarId: "calendar-id",
      syncToken: encodeStoredSyncToken(
        "https://graph.microsoft.com/delta?$deltatoken=current",
        OUTLOOK_SYNC_TOKEN_VERSION,
      ),
    });

    await expect(fetcher.fetchEvents()).resolves.toEqual({
      events: [],
      fullSyncRequired: true,
      syncWindow: TEST_PLAN.window,
    });
  });

  it("requests a full sync instead of replaying a delta with no successor link", async () => {
    globalThis.fetch = fetchOutlookDeltaWithoutSuccessor;

    const result = await createOutlookSourceFetcher({
      accessToken: "test-token",
      calendarId: CALENDAR_ID,
      plan: TEST_PLAN,
      externalCalendarId: "calendar-id",
      syncToken: encodeStoredSyncToken(
        "https://graph.microsoft.com/delta?$deltatoken=current",
        OUTLOOK_SYNC_TOKEN_VERSION,
      ),
    }).fetchEvents();

    expect(result).toEqual({
      events: [],
      fullSyncRequired: true,
      syncWindow: TEST_PLAN.window,
    });
  });
});
