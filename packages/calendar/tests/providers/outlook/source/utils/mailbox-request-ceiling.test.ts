import { afterEach, describe, expect, it } from "vitest";
import { createOutlookAccountRequestLimiter } from "../../../../../src/core/utils/redis-rate-limiter";
import { fetchCalendarEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { OutlookCalendarEvent } from "../../../../../src/providers/outlook/source/types";
import type { RedisRateLimiter } from "../../../../../src/core/utils/redis-rate-limiter";

const MAILBOX_REQUEST_CEILING = 3;
const SERIES_MASTERS_PER_CALENDAR = 6;
const INSTANCES_PER_MASTER = 2;
const ACCOUNT_ID = "account-a";
const CALENDAR_IDS = ["calendar-a", "calendar-b", "calendar-c"];
const RESPONSE_DELAY_MS = 5;
const TIME_MIN = new Date("2026-07-01T00:00:00.000Z");
const TIME_MAX = new Date("2026-07-31T00:00:00.000Z");

const originalFetch = globalThis.fetch;

interface FakeEntry {
  expiresAt: number;
  value: string;
}

class FakeRedis {
  public store = new Map<string, FakeEntry>();

  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }

  public set(key: string, value: string, ...options: string[]): Promise<string | null> {
    this.prune();
    let expiresAt = Number.POSITIVE_INFINITY;
    let onlyIfAbsent = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = String(options[index]).toUpperCase();
      if (option === "NX") {
        onlyIfAbsent = true;
      }
      if (option === "PX") {
        expiresAt = Date.now() + Number(options[index + 1]);
        index += 1;
      }
    }
    if (onlyIfAbsent && this.store.has(key)) {
      return Promise.resolve(null);
    }
    this.store.set(key, { expiresAt, value });
    return Promise.resolve("OK");
  }

  public del(...keys: string[]): Promise<number> {
    this.prune();
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }
}

interface InFlightState {
  inFlight: number;
  maxInFlight: number;
  totalRequests: number;
}

const resolveInputUrl = (input: Request | URL | string): string => {
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof input === "string") {
    return input;
  }
  return input.url;
};

const createInstanceEvent = (masterId: string, occurrence: number): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-07-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: `${masterId}-uid-${occurrence}`,
  id: `${masterId}-occurrence-${occurrence}`,
  start: {
    dateTime: "2026-07-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
  type: "occurrence",
});

const createSeriesMasterEvent = (calendarId: string, index: number): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-07-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: `${calendarId}-master-uid-${index}`,
  id: `${calendarId}-master-${index}`,
  start: {
    dateTime: "2026-07-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
  type: "seriesMaster",
});

const buildResponseBody = (url: string): unknown => {
  const instancesMatch = /\/events\/([^/]+)\/instances/.exec(url);
  if (instancesMatch) {
    const masterId = decodeURIComponent(instancesMatch[1] ?? "");
    return {
      value: Array.from(
        { length: INSTANCES_PER_MASTER },
        (_ignored, index) => createInstanceEvent(masterId, index),
      ),
    };
  }
  const calendarMatch = /\/me\/calendars\/([^/]+)\//.exec(url);
  const calendarId = decodeURIComponent(calendarMatch?.[1] ?? "unknown");
  return {
    "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView/delta?$deltatoken=next`,
    value: Array.from(
      { length: SERIES_MASTERS_PER_CALENDAR },
      (_ignored, index) => createSeriesMasterEvent(calendarId, index),
    ),
  };
};

const createInFlightTrackingFetch = (state: InFlightState): typeof fetch => {
  const trackingFetch = async (input: Request | URL | string): Promise<Response> => {
    const url = resolveInputUrl(input);
    state.inFlight += 1;
    state.totalRequests += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((resolve) => {
      setTimeout(resolve, RESPONSE_DELAY_MS);
    });
    state.inFlight -= 1;
    return Response.json(buildResponseBody(url));
  };
  trackingFetch.preconnect = originalFetch.preconnect;
  return trackingFetch;
};

const createAccountRequestLimiter = (redis: FakeRedis): RedisRateLimiter =>
  createOutlookAccountRequestLimiter(redis, ACCOUNT_ID);

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("outlook mailbox request ceiling", () => {
  it("never exceeds the account ceiling of in-flight Graph requests across calendars", async () => {
    const state: InFlightState = { inFlight: 0, maxInFlight: 0, totalRequests: 0 };
    globalThis.fetch = createInFlightTrackingFetch(state);
    const redis = new FakeRedis();

    const results = await Promise.all(CALENDAR_IDS.map((calendarId) => fetchCalendarEvents({
      accessToken: "token",
      calendarId,
      rateLimiter: createAccountRequestLimiter(redis),
      timeMax: TIME_MAX,
      timeMin: TIME_MIN,
    })));

    const expandedCount = results.flatMap((result) => result.events).length;
    expect(expandedCount).toBe(
      CALENDAR_IDS.length * SERIES_MASTERS_PER_CALENDAR * INSTANCES_PER_MASTER,
    );
    expect(state.totalRequests).toBeGreaterThan(MAILBOX_REQUEST_CEILING);
    expect(state.maxInFlight).toBeLessThanOrEqual(MAILBOX_REQUEST_CEILING);
    expect(state.maxInFlight).toBe(MAILBOX_REQUEST_CEILING);
  });
});
