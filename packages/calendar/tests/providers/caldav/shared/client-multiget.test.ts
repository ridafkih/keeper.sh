import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVClient,
  CalDAVIncompleteMultiGetError,
} from "../../../../src/providers/caldav/shared/client";
import type { CalDAVListingStats } from "../../../../src/providers/caldav/shared/client";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";

const davMocks = vi.hoisted(() => ({
  calendarQuery: vi.fn(),
  fetchCalendarObjects: vi.fn(),
}));

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: () => Promise.resolve({
    calendarQuery: davMocks.calendarQuery,
    fetchCalendarObjects: davMocks.fetchCalendarObjects,
  }),
}));

const SERVER_URL = "https://caldav.example.com";
const CALENDAR_PATH = "/cal/u/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;

const MULTIGET_BATCH_SIZE = 250;
const ZOHO_RESPONSE_CAP = 1000;
const ZOHO_HREF_COUNT = 1971;

interface MultiGetRow {
  data?: unknown;
  etag?: string;
  url: string;
}

const objectPath = (index: number): string =>
  `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`;

const objectPaths = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => objectPath(index));

const icsFor = (uid: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20260620T090000Z\r\nDTEND:20260620T100000Z\r\nSUMMARY:Event\r\nEND:VEVENT\r\nEND:VCALENDAR`;

const rowsFor = (paths: string[]): MultiGetRow[] =>
  paths.map((path) => ({ data: icsFor(path), etag: `"etag-${path}"`, url: `${SERVER_URL}${path}` }));

let queriedPaths: string[] = [];

const answerQueryWith = (hrefs: string[]): void => {
  queriedPaths = hrefs;
  davMocks.calendarQuery.mockResolvedValue(hrefs.map((href) => ({ href })));
};

const answerMultigetWith = (respond: (objectUrls: string[]) => MultiGetRow[]): void => {
  davMocks.fetchCalendarObjects.mockImplementation(({ objectUrls }: { objectUrls?: string[] }) =>
    Promise.resolve(respond(objectUrls ?? queriedPaths)));
};

const respondsWithAtMost = (rowsPerResponse: number) => (objectUrls: string[]): MultiGetRow[] =>
  rowsFor(objectUrls.slice(0, rowsPerResponse));

const requestedBatches = (): (string[] | undefined)[] =>
  davMocks.fetchCalendarObjects.mock.calls.map(([{ objectUrls }]) => objectUrls);

const largestBatchSize = (): number =>
  Math.max(...requestedBatches().map((batch) => batch?.length ?? Number.POSITIVE_INFINITY));

const createClient = () =>
  new CalDAVClient({
    credentials: { password: "pass", username: "user" },
    serverUrl: SERVER_URL,
  });

const fetchObjects = () => createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

const pathsOf = (objects: { url: string }[]): string[] =>
  objects.map((object) => new URL(object.url).pathname);

const captureRejection = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("expected the operation to reject");
};

beforeEach(() => {
  vi.clearAllMocks();
  answerQueryWith([]);
  answerMultigetWith(rowsFor);
});

describe("CalDAVClient.fetchCalendarObjects against a capped multiget", () => {
  it("fetches every object when the server caps a multiget response at 1,000", async () => {
    const paths = objectPaths(ZOHO_HREF_COUNT);
    answerQueryWith(paths);
    answerMultigetWith(respondsWithAtMost(ZOHO_RESPONSE_CAP));

    const objects = await fetchObjects();

    expect(objects).toHaveLength(ZOHO_HREF_COUNT);
    expect(pathsOf(objects)).toEqual(paths);
    expect(largestBatchSize()).toBeLessThan(ZOHO_RESPONSE_CAP);
  });

  it("issues one calendar-multiget per bounded batch of hrefs", async () => {
    const paths = objectPaths(ZOHO_HREF_COUNT);
    answerQueryWith(paths);

    await fetchObjects();

    const batches = requestedBatches();
    expect(batches).toHaveLength(Math.ceil(ZOHO_HREF_COUNT / MULTIGET_BATCH_SIZE));
    expect(largestBatchSize()).toBeLessThanOrEqual(MULTIGET_BATCH_SIZE);
    expect(batches.flatMap((batch) => batch ?? [])).toEqual(paths);
  });

  it("rejects instead of returning a short object set when hrefs are never returned", async () => {
    answerQueryWith(objectPaths(ZOHO_HREF_COUNT));
    answerMultigetWith(respondsWithAtMost(100));

    const error = await captureRejection(fetchObjects);

    expect(error).toMatchObject({
      batchCount: 8,
      hrefsRequested: ZOHO_HREF_COUNT,
      name: "CalDAVIncompleteMultiGetError",
      objectsReturned: 800,
    });
    expect((error as { missingHrefs: string[] }).missingHrefs).toHaveLength(5);
    expect((error as Error).message).toMatch(/800 of 1971/);
  });

  it("rejects a multiget row whose calendar-data element is empty instead of passing a non-string to the parser", async () => {
    const paths = objectPaths(2);
    answerQueryWith(paths);
    answerMultigetWith((objectUrls) => [
      ...rowsFor(objectUrls.slice(0, 1)),
      { data: {}, url: `${SERVER_URL}${objectUrls[1] ?? ""}` },
    ]);

    const error = await captureRejection(fetchObjects);

    expect(error).toMatchObject({ name: "CalDAVIncompleteMultiGetError" });
    expect((error as { missingHrefs: string[] }).missingHrefs).toEqual([paths[1]]);
  });
});

describe("CalDAVClient.fetchCalendarObjects on healthy calendars", () => {
  it("issues no multiget when the calendar-query returns no hrefs", async () => {
    answerQueryWith([]);

    await expect(fetchObjects()).resolves.toEqual([]);
    expect(davMocks.fetchCalendarObjects).not.toHaveBeenCalled();
  });

  it("issues a single multiget for a calendar smaller than one batch", async () => {
    answerQueryWith(objectPaths(10));

    const objects = await fetchObjects();

    expect(requestedBatches()).toHaveLength(1);
    expect(objects).toHaveLength(10);
  });

  it("requests a duplicated href only once", async () => {
    const path = objectPath(0);
    answerQueryWith([path, path, path]);

    const objects = await fetchObjects();

    expect(requestedBatches()).toEqual([[path]]);
    expect(objects).toHaveLength(1);
  });

  it("ignores calendar-query hrefs that are not calendar objects", async () => {
    const path = objectPath(0);
    answerQueryWith([CALENDAR_PATH, `${CALENDAR_PATH}notes.txt`, path]);

    await fetchObjects();

    expect(requestedBatches()).toEqual([[path]]);
  });

  it("supplies its own url filter so tsdav cannot drop a requested path", async () => {
    answerQueryWith([objectPath(0)]);

    await fetchObjects();

    const { urlFilter } = davMocks.fetchCalendarObjects.mock.calls[0]?.[0] ?? {};
    expect(urlFilter?.(`${SERVER_URL}${objectPath(0)}`)).toBe(true);
    expect(urlFilter?.(`${SERVER_URL}${CALENDAR_PATH}notes.txt`)).toBe(false);
    expect(urlFilter?.(`https://cal.ics.example.com${CALENDAR_PATH}notes.txt`)).toBe(false);
  });

  it("matches a percent-encoded requested href against a decoded response href", async () => {
    answerQueryWith([`${CALENDAR_PATH}a%20b.ics`, `${CALENDAR_PATH}c d.ics`]);
    answerMultigetWith(() => [
      { data: icsFor("a b"), url: `${SERVER_URL}${CALENDAR_PATH}a b.ics` },
      { data: icsFor("c d"), url: `${SERVER_URL}${CALENDAR_PATH}c%20d.ics` },
    ]);

    await expect(fetchObjects()).resolves.toHaveLength(2);
  });

  it("does not reject when the server returns rows that were not requested", async () => {
    const paths = objectPaths(3);
    answerQueryWith(paths);
    answerMultigetWith((objectUrls) => rowsFor([...objectUrls, `${CALENDAR_PATH}surprise.ics`]));

    const objects = await fetchObjects();

    expect(pathsOf(objects)).toEqual(paths);
  });

  it("returns objects in requested-href order", async () => {
    const paths = objectPaths(5);
    answerQueryWith(paths);
    answerMultigetWith((objectUrls) => rowsFor(objectUrls.toReversed()));

    const objects = await fetchObjects();

    expect(pathsOf(objects)).toEqual(paths);
  });
});

describe("CalDAVClient.fetchCalendarObjects listing diagnostics", () => {
  const captureListings = async (): Promise<CalDAVListingStats[]> => {
    const listings: CalDAVListingStats[] = [];
    await createClient()
      .fetchCalendarObjects({
        calendarUrl: CALENDAR_URL,
        onListing: (stats) => { listings.push(stats); },
      })
      .catch(() => null);
    return listings;
  };

  it("reports what the calendar-query listed, what the multiget asked for, and what came back", async () => {
    answerQueryWith(objectPaths(3));

    await expect(captureListings()).resolves.toEqual([{
      listedCount: 3,
      requestedCount: 3,
      returnedCount: 3,
      unrequestedCount: 0,
    }]);
  });

  it("counts objects the server returned that were never requested", async () => {
    answerQueryWith(objectPaths(3));
    answerMultigetWith((objectUrls) => rowsFor([...objectUrls, `${CALENDAR_PATH}surprise.ics`]));

    const [listing] = await captureListings();

    expect(listing).toMatchObject({ requestedCount: 3, returnedCount: 3, unrequestedCount: 1 });
  });

  it("does not count listed hrefs that are not calendar objects", async () => {
    answerQueryWith([CALENDAR_PATH, `${CALENDAR_PATH}notes.txt`, objectPath(0)]);

    const [listing] = await captureListings();

    expect(listing).toMatchObject({ listedCount: 1, requestedCount: 1 });
  });

  it("reports an empty listing when the calendar-query returns no hrefs", async () => {
    answerQueryWith([]);

    await expect(captureListings()).resolves.toEqual([{
      listedCount: 0,
      requestedCount: 0,
      returnedCount: 0,
      unrequestedCount: 0,
    }]);
  });

  it("reports the listing before rejecting an incomplete multiget", async () => {
    answerQueryWith(objectPaths(4));
    answerMultigetWith(respondsWithAtMost(1));

    const [listing] = await captureListings();

    expect(listing).toMatchObject({ listedCount: 4, requestedCount: 4, returnedCount: 1 });
  });
});

describe("CalDAVClient.fetchCalendarObjects with a path filter", () => {
  const acceptedPath = `${CALENDAR_PATH}accepted.ics`;
  const rejectedPath = `${CALENDAR_PATH}rejected.ics`;
  const acceptOnly = (path: string): boolean => path === acceptedPath;

  const fetchFilteredObjects = () =>
    createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL, pathFilter: acceptOnly });

  it("downloads only the hrefs the filter accepts", async () => {
    answerQueryWith([rejectedPath, acceptedPath]);

    const objects = await fetchFilteredObjects();

    expect(requestedBatches()).toEqual([[acceptedPath]]);
    expect(pathsOf(objects)).toEqual([acceptedPath]);
  });

  it("issues no multiget when the filter rejects every href", async () => {
    answerQueryWith([rejectedPath]);

    await expect(fetchFilteredObjects()).resolves.toEqual([]);
    expect(davMocks.fetchCalendarObjects).not.toHaveBeenCalled();
  });

  it("does not count filtered-out hrefs as missing", async () => {
    answerQueryWith([rejectedPath, acceptedPath]);
    answerMultigetWith((objectUrls) => rowsFor(objectUrls));

    await expect(fetchFilteredObjects()).resolves.toHaveLength(1);
  });

  it("still rejects when an accepted href is never returned", async () => {
    answerQueryWith([rejectedPath, acceptedPath]);
    answerMultigetWith(() => []);

    const error = await captureRejection(fetchFilteredObjects);

    expect(error).toMatchObject({
      hrefsRequested: 1,
      name: "CalDAVIncompleteMultiGetError",
    });
    expect((error as { missingHrefs: string[] }).missingHrefs).toEqual([acceptedPath]);
  });
});

describe("CalDAVIncompleteMultiGetError", () => {
  const createError = () =>
    new CalDAVIncompleteMultiGetError({
      batchCount: 8,
      calendarUrl: CALENDAR_URL,
      hrefsRequested: ZOHO_HREF_COUNT,
      missingHrefs: Array.from(
        { length: 20 },
        (_unused, index) => `${CALENDAR_PATH}${String(index)}.ics`,
      ),
      objectsReturned: 800,
    });

  it("reports both counts and a bounded sample of the missing hrefs", () => {
    const error = createError();

    expect(error.message).toBe(
      `CalDAV multiget returned 800 of 1971 requested objects for ${CALENDAR_URL}`,
    );
    expect(error.missingHrefs).toHaveLength(5);
    expect(error.batchCount).toBe(8);
  });

  it("reports the shortfall without looking like an authentication failure", () => {
    const error = createError();

    expect(isCalDAVAuthenticationError(error)).toBe(false);
    expect("status" in error).toBe(false);
    expect("statusCode" in error).toBe(false);
  });
});
