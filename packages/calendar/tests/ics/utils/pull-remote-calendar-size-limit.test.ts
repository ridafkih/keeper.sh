import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { fixtureManifest, getFixturePath } from "@keeper.sh/fixtures";
import {
  CalendarFetchError,
  MAX_ICS_FEED_BYTES,
  pullRemoteCalendar,
} from "../../../src/ics/utils/pull-remote-calendar";
import { isResponseTooLargeError } from "../../../src/utils/bounded-response";
import {
  createEndlessGzipBody,
  RUNTIME_STOPS_ABORTED_TRANSFERS,
  startRemoteBodyServer,
} from "../../utils/remote-body-server";

const MEBIBYTE = 1024 * 1024;
const HEADROOM_FACTOR = 5;
const KNOWN_FEEDS = fixtureManifest
  .map((fixtureSource) => readFileSync(getFixturePath(fixtureSource)))
  .toSorted((first, second) => second.byteLength - first.byteLength);
const [LARGEST_KNOWN_FEED = Buffer.alloc(0)] = KNOWN_FEEDS;
const FEED_HEADER = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//Test//EN\r\n";
const DESCRIPTION_BLOCK = Buffer.from(`X-PADDING:${"A".repeat(MEBIBYTE)}\r\n`);

const CALENDAR_HEADERS = { "content-type": "text/calendar" };
const TRANSFER_SLACK_BYTES = 64 * MEBIBYTE;

const endless = createEndlessGzipBody(DESCRIPTION_BLOCK, CALENDAR_HEADERS, "stored");
const endlessDeflated = createEndlessGzipBody(DESCRIPTION_BLOCK, CALENDAR_HEADERS, "deflated");
const endlessNotFound = createEndlessGzipBody(DESCRIPTION_BLOCK, CALENDAR_HEADERS, "stored", 404);

const captureRejection = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the feed to be rejected");
};

const server = await startRemoteBodyServer({
  "/declared-oversized.ics": (_request, response) => {
    response.writeHead(200, {
      "content-length": String(MAX_ICS_FEED_BYTES + 1),
      "content-type": "text/calendar",
    });
    response.write(FEED_HEADER);
  },
  "/endless-deflated.ics": endlessDeflated.handler,
  "/endless.ics": endless.handler,
  "/missing.ics": endlessNotFound.handler,
  "/largest-known.ics": (_request, response) => {
    response.writeHead(200, { "content-encoding": "gzip", "content-type": "text/calendar" });
    response.end(gzipSync(LARGEST_KNOWN_FEED));
  },
});

afterEach(() => {
  for (const { tracker } of [endless, endlessDeflated, endlessNotFound]) {
    tracker.hangUp();
  }
});

afterAll(async () => {
  await server.close();
});

describe("pullRemoteCalendar feed size limit", () => {
  it("leaves several times the largest known public feed of headroom", () => {
    expect(LARGEST_KNOWN_FEED.byteLength).toBeGreaterThan(MEBIBYTE);
    expect(MAX_ICS_FEED_BYTES).toBeGreaterThanOrEqual(LARGEST_KNOWN_FEED.byteLength * HEADROOM_FACTOR);
  });

  it("still reads the largest known public feed when it is served compressed", async () => {
    const { ical } = await pullRemoteCalendar("ical", server.url("/largest-known.ics"));

    expect(Buffer.byteLength(ical)).toBe(LARGEST_KNOWN_FEED.byteLength);
  });

  it("names a compressed feed that never ends as too large", async () => {
    const error = await captureRejection(pullRemoteCalendar("ical", server.url("/endless.ics")));

    expect(error).toBeInstanceOf(CalendarFetchError);
    expect(error).toMatchObject({ authRequired: false, reason: "too_large" });
    expect(isResponseTooLargeError(error)).toBe(true);
  });

  it.runIf(RUNTIME_STOPS_ABORTED_TRANSFERS)(
    "stops downloading a compressed feed that never ends",
    async () => {
      await captureRejection(pullRemoteCalendar("ical", server.url("/endless.ics")));
      const servedWhenStalled = await endless.tracker.stalled();

      expect(servedWhenStalled).toBeLessThan(2 * MAX_ICS_FEED_BYTES + TRANSFER_SLACK_BYTES);
      expect(endless.tracker.uncompressedBytes()).toBe(servedWhenStalled);
    },
  );

  it("keeps memory bounded while refusing a feed that inflates without end", async () => {
    const residentBefore = process.memoryUsage().rss;

    const error = await captureRejection(
      pullRemoteCalendar("ical", server.url("/endless-deflated.ics")),
    );
    const residentGrowth = process.memoryUsage().rss - residentBefore;

    expect(error).toMatchObject({ reason: "too_large" });
    expect(residentGrowth).toBeLessThan(MAX_ICS_FEED_BYTES * 4);
  });

  it("names a missing feed as not found however large its body is", async () => {
    const error = await captureRejection(pullRemoteCalendar("ical", server.url("/missing.ics")));

    expect(error).toMatchObject({ reason: "not_found" });
  });

  it.runIf(RUNTIME_STOPS_ABORTED_TRANSFERS)(
    "stops downloading the body of a feed it rejects on status",
    async () => {
      await captureRejection(pullRemoteCalendar("ical", server.url("/missing.ics")));
      const servedWhenStalled = await endlessNotFound.tracker.stalled();

      expect(servedWhenStalled).toBeLessThan(TRANSFER_SLACK_BYTES);
      expect(endlessNotFound.tracker.uncompressedBytes()).toBe(servedWhenStalled);
    },
  );

  it("names a feed that declares an oversized length as too large without downloading it", async () => {
    const error = await captureRejection(
      pullRemoteCalendar("ical", server.url("/declared-oversized.ics")),
    );

    expect(error).toMatchObject({ reason: "too_large" });
  });

  it("tells the user how large a feed may be", async () => {
    const error = await captureRejection(pullRemoteCalendar("ical", server.url("/endless.ics")));

    expect(error).toMatchObject({
      message: "Calendar feed is too large. Feeds up to 25 MB are supported.",
    });
  });
});
