import { afterEach, describe, expect, it } from "vitest";
import { fetchCalendarEvents } from "../../../../../src/providers/outlook/source/utils/fetch-events";
import type { OutlookCalendarEvent } from "../../../../../src/providers/outlook/source/types";

const CALENDAR_ID = "calendar-throttled";
const SERIES_MASTER_COUNT = 12;
const FAILING_MASTER_ID = `${CALENDAR_ID}-master-0`;
const THROTTLED_STATUS = 429;
const MAX_INSTANCE_REQUESTS_AFTER_FAILURE = 6;
const DRAIN_TICKS = 25;

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

const createInstanceEvent = (masterId: string, occurrence: number): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-03-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: `${masterId}-uid-${occurrence}`,
  id: `${masterId}-occurrence-${occurrence}`,
  start: {
    dateTime: "2026-03-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
  type: "occurrence",
});

const createSeriesMasterEvent = (index: number): OutlookCalendarEvent => ({
  end: {
    dateTime: "2026-03-08T15:00:00",
    timeZone: "UTC",
  },
  iCalUId: `${CALENDAR_ID}-master-uid-${index}`,
  id: `${CALENDAR_ID}-master-${index}`,
  start: {
    dateTime: "2026-03-08T14:00:00",
    timeZone: "UTC",
  },
  subject: "Outlook Planning",
  type: "seriesMaster",
});

const createDeltaPageBody = (): unknown => ({
  "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/calendars/${CALENDAR_ID}/calendarView/delta?$deltatoken=next`,
  value: Array.from({ length: SERIES_MASTER_COUNT }, (_ignored, index) => createSeriesMasterEvent(index)),
});

const createThrottlingFetch = (requestedMasterIds: string[]): typeof fetch => {
  const throttlingFetch = async (input: Request | URL | string): Promise<Response> => {
    const url = resolveInputUrl(input);
    const instancesMatch = /\/events\/([^/]+)\/instances/.exec(url);
    if (!instancesMatch) {
      await Promise.resolve();
      return Response.json(createDeltaPageBody());
    }

    const masterId = decodeURIComponent(instancesMatch[1] ?? "");
    requestedMasterIds.push(masterId);
    await Promise.resolve();

    if (masterId === FAILING_MASTER_ID) {
      return Response.json(
        { error: { code: "TooManyRequests", message: "throttled" } },
        { status: THROTTLED_STATUS },
      );
    }

    return Response.json({
      value: [createInstanceEvent(masterId, 1), createInstanceEvent(masterId, 2)],
    });
  };
  throttlingFetch.preconnect = originalFetch.preconnect;
  return throttlingFetch;
};

const drainPendingWork = async (): Promise<void> => {
  for (let tick = 0; tick < DRAIN_TICKS; tick++) {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("outlook source expansion failure handling", () => {
  it("stops issuing instance requests once one series master fails", async () => {
    const requestedMasterIds: string[] = [];
    globalThis.fetch = createThrottlingFetch(requestedMasterIds);

    const fetchResult = await fetchCalendarEvents({
      accessToken: "token",
      calendarId: CALENDAR_ID,
      timeMax: new Date("2026-07-31T00:00:00.000Z"),
      timeMin: new Date("2026-07-01T00:00:00.000Z"),
    }).then(() => "resolved").catch(() => "rejected");

    await drainPendingWork();

    expect(fetchResult).toBe("rejected");
    expect(requestedMasterIds).toContain(FAILING_MASTER_ID);
    expect(requestedMasterIds.length).toBeLessThanOrEqual(MAX_INSTANCE_REQUESTS_AFTER_FAILURE);
    expect(requestedMasterIds.length).toBeLessThan(SERIES_MASTER_COUNT);
  });
});
