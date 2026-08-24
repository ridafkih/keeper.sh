import { afterEach, describe, expect, it } from "vitest";
import type { RedisRateLimiter } from "../../../../src/core/utils/redis-rate-limiter";
import { createOutlookSourceFetcher } from "../../../../src/providers/outlook/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";

const CALENDAR_ID = "calendar-id";
const TEST_PLAN = createSourceIngestionPlan("1_week", "2_years");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createOutlookSourceFetcher rate limiter consumption", () => {
  it("acquires the account semaphore before issuing a Graph request", async () => {
    const acquireCalls: number[] = [];
    let graphRequestsBeforeFirstAcquire = 0;
    let graphRequests = 0;
    const rateLimiter: RedisRateLimiter = {
      acquire: (count: number): Promise<void> => {
        acquireCalls.push(count);
        return Promise.resolve();
      },
    };
    const queuedFetch = (): Promise<Response> => {
      graphRequests += 1;
      if (acquireCalls.length === 0) {
        graphRequestsBeforeFirstAcquire += 1;
      }
      return Promise.resolve(Response.json({
        "@odata.deltaLink": "https://graph.microsoft.com/delta?$deltatoken=next",
        value: [],
      }));
    };
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;

    // Production passes the rate limiter through a widened params type, not the published one.
    const params: Parameters<typeof createOutlookSourceFetcher>[0] & {
      rateLimiter?: RedisRateLimiter;
    } = {
      accessToken: "test-token",
      calendarId: CALENDAR_ID,
      externalCalendarId: "calendar-id",
      plan: TEST_PLAN,
      rateLimiter,
      syncToken: null,
    };
    const fetcher = createOutlookSourceFetcher(params);

    await fetcher.fetchEvents();

    expect(graphRequests).toBeGreaterThan(0);
    expect(acquireCalls.length).toBeGreaterThan(0);
    expect(graphRequestsBeforeFirstAcquire).toBe(0);
  });
});
