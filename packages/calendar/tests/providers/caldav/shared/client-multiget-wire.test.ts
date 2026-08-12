import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDAVClient } from "tsdav";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import {
  CALENDAR_PATH,
  createCalDAVServerStub,
  hrefsIn,
  SERVER_URL,
} from "./caldav-server-stub";

const fetchMocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock("../../../../src/utils/safe-fetch", () => ({
  createSafeFetch: () => fetchMocks.safeFetch,
}));

const TIME_RANGE = { end: "2028-06-15T00:00:00.000Z", start: "2026-05-15T00:00:00.000Z" };

const objectPaths = (count: number): string[] =>
  Array.from(
    { length: count },
    (_unused, index) => `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`,
  );

const stripHrefs = (body: string): string =>
  body.replaceAll(/<(?:[a-z0-9]+:)?href>[^<]*<\/(?:[a-z0-9]+:)?href>/gi, "");

const bodiesFromOurClient = async (
  hrefs: string[],
  timeRange: { end: string; start: string } | null,
) => {
  const stub = createCalDAVServerStub({ queryHrefs: hrefs });
  fetchMocks.safeFetch.mockImplementation(stub.handle);

  const client = new CalDAVClient({
    credentials: { password: "pass", username: "user" },
    serverUrl: SERVER_URL,
  });
  await client.fetchCalendarObjects({
    calendarUrl: stub.calendarUrl,
    ...(timeRange && { timeRange }),
  });

  return stub;
};

const bodiesFromTsdav = async (
  hrefs: string[],
  timeRange: { end: string; start: string } | null,
) => {
  const stub = createCalDAVServerStub({ queryHrefs: hrefs });
  const client = await createDAVClient({
    authFunction: () => Promise.resolve({}),
    authMethod: "Custom",
    credentials: { password: "pass", username: "user" },
    defaultAccountType: "caldav",
    fetch: stub.handle,
    serverUrl: SERVER_URL,
  });
  await client.fetchCalendarObjects({
    calendar: { url: stub.calendarUrl },
    ...(timeRange && { timeRange }),
  });

  return stub;
};

describe("CalDAV report bodies stay byte-identical to tsdav's", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const [label, timeRange] of [
    ["without a timeRange", null],
    ["with a timeRange", TIME_RANGE],
  ] as const) {
    it(`sends the same calendar-query body tsdav sends ${label}`, async () => {
      const hrefs = objectPaths(3);

      const ours = await bodiesFromOurClient(hrefs, timeRange);
      const theirs = await bodiesFromTsdav(hrefs, timeRange);

      expect(ours.queryBodies()).toHaveLength(1);
      expect(ours.queryBodies()[0]).toBe(theirs.queryBodies()[0]);
    });

    it(`sends the same calendar-multiget body tsdav sends ${label}`, async () => {
      const hrefs = objectPaths(3);

      const ours = await bodiesFromOurClient(hrefs, timeRange);
      const theirs = await bodiesFromTsdav(hrefs, timeRange);

      const theirBody = theirs.multigetBodies()[0] ?? "";
      expect(ours.multigetBodies().length).toBeGreaterThan(0);
      for (const body of ours.multigetBodies()) {
        expect(stripHrefs(body)).toBe(stripHrefs(theirBody));
      }
      expect(ours.multigetBodies().flatMap((body) => hrefsIn(body)))
        .toEqual(hrefsIn(theirBody));
    });
  }
});
