import { beforeEach, describe, expect, it, vi } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import {
  CALENDAR_PATH,
  createCalDAVServerStub,
  hrefsIn,
  SERVER_URL,
} from "./caldav-server-stub";
import type { CalDAVServerStub, MultiGetRow } from "./caldav-server-stub";

const fetchMocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock("../../../../src/utils/safe-fetch", () => ({
  createSafeFetch: () => fetchMocks.safeFetch,
}));

const MAX_BATCH_HREFS = 250;
const ZOHO_RESPONSE_CAP = 1000;
const ZOHO_HREF_COUNT = 1971;

const objectPath = (index: number): string =>
  `${CALENDAR_PATH}event-${String(index).padStart(4, "0")}.ics`;

const objectPaths = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => objectPath(index));

const icsFor = (href: string): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${href}\r\nDTSTART:20260620T090000Z\r\nDTEND:20260620T100000Z\r\nSUMMARY:Event\r\nEND:VEVENT\r\nEND:VCALENDAR`;

const rowsFor = (hrefs: string[]): MultiGetRow[] =>
  hrefs.map((href) => ({ data: icsFor(href), href }));

const cappedAt = (limit: number) => (hrefs: string[]): MultiGetRow[] =>
  rowsFor(hrefs.slice(0, limit));

const installStub = (stub: CalDAVServerStub): CalDAVServerStub => {
  fetchMocks.safeFetch.mockImplementation(stub.handle);
  return stub;
};

const createClient = () =>
  new CalDAVClient({
    credentials: { password: "pass", username: "user" },
    serverUrl: SERVER_URL,
  });

const fetchObjects = (stub: CalDAVServerStub) =>
  createClient().fetchCalendarObjects({ calendarUrl: stub.calendarUrl });

const captureRejection = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("expected the operation to reject");
};

describe("CalDAVClient.fetchCalendarObjects against a capped multiget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /*
   * Regression for #461. Zoho answers a calendar-multiget covering 1,971 hrefs
   * with a successful 207 carrying only the first 1,000 calendar-data entries.
   * Nothing in tsdav reconciles requested hrefs against returned rows, so the
   * remainder was silently dropped and ingestion reported success with zero
   * events added.
   */
  it("fetches every object when the server caps a multiget response at 1,000", async () => {
    const paths = objectPaths(ZOHO_HREF_COUNT);
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: paths,
      respond: cappedAt(ZOHO_RESPONSE_CAP),
    }));

    const objects = await fetchObjects(stub);

    expect(objects).toHaveLength(ZOHO_HREF_COUNT);
    const returnedPaths = objects.map((object) => new URL(object.url).pathname);
    expect(new Set(returnedPaths).size).toBe(ZOHO_HREF_COUNT);
    expect(new Set(returnedPaths)).toEqual(new Set(paths));
  });

  it("issues one calendar-multiget per bounded batch of hrefs", async () => {
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: objectPaths(ZOHO_HREF_COUNT),
    }));

    await fetchObjects(stub);

    const bodies = stub.multigetBodies();
    expect(bodies).toHaveLength(Math.ceil(ZOHO_HREF_COUNT / MAX_BATCH_HREFS));
    expect(bodies.every((body) => hrefsIn(body).length <= MAX_BATCH_HREFS)).toBe(true);
    expect(bodies.flatMap((body) => hrefsIn(body))).toHaveLength(ZOHO_HREF_COUNT);
  });

  it("rejects instead of returning a short object set when hrefs are never returned", async () => {
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: objectPaths(ZOHO_HREF_COUNT),
      respond: cappedAt(100),
    }));

    const error = await captureRejection(() => fetchObjects(stub));

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
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: paths,
      respond: (hrefs) => [{ data: icsFor(hrefs[0] ?? ""), href: hrefs[0] ?? "" }, { href: hrefs[1] ?? "" }],
    }));

    const error = await captureRejection(() => fetchObjects(stub));

    expect(error).toMatchObject({ name: "CalDAVIncompleteMultiGetError" });
    expect((error as { missingHrefs: string[] }).missingHrefs).toContain(paths[1]);
  });
});

describe("CalDAVClient.fetchCalendarObjects on healthy calendars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issues no multiget when the calendar-query returns no hrefs", async () => {
    const stub = installStub(createCalDAVServerStub({ queryHrefs: [] }));

    await expect(fetchObjects(stub)).resolves.toEqual([]);
    expect(stub.multigetBodies()).toHaveLength(0);
  });

  it("requests a duplicated href only once", async () => {
    const path = objectPath(0);
    const stub = installStub(createCalDAVServerStub({ queryHrefs: [path, path, path] }));

    const objects = await fetchObjects(stub);

    expect(stub.multigetBodies()).toHaveLength(1);
    expect(hrefsIn(stub.multigetBodies()[0] ?? "")).toEqual([path]);
    expect(objects).toHaveLength(1);
  });

  it("matches percent-encoded response hrefs against the requested hrefs", async () => {
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: [`${CALENDAR_PATH}a%20b.ics`, `${CALENDAR_PATH}c d.ics`],
      respond: (hrefs) => [
        { data: icsFor(hrefs[0] ?? ""), href: decodeURIComponent(hrefs[0] ?? "") },
        { data: icsFor(hrefs[1] ?? ""), href: hrefs[1] ?? "" },
      ],
    }));

    await expect(fetchObjects(stub)).resolves.toHaveLength(2);
  });

  it("does not reject when the server returns rows that were not requested", async () => {
    const paths = objectPaths(3);
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: paths,
      respond: (hrefs) => rowsFor([...hrefs, `${CALENDAR_PATH}surprise.ics`]),
    }));

    const objects = await fetchObjects(stub);

    expect(objects.map((object) => new URL(object.url).pathname))
      .toEqual(expect.arrayContaining(paths));
  });

  it("issues a single multiget for a calendar smaller than one batch", async () => {
    const stub = installStub(createCalDAVServerStub({ queryHrefs: objectPaths(10) }));

    const objects = await fetchObjects(stub);

    expect(stub.multigetBodies()).toHaveLength(1);
    expect(objects).toHaveLength(10);
  });

  it("ignores calendar-query hrefs that are not calendar objects", async () => {
    const path = objectPath(0);
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: [CALENDAR_PATH, `${CALENDAR_PATH}notes.txt`, path],
    }));

    await fetchObjects(stub);

    expect(stub.multigetBodies().flatMap((body) => hrefsIn(body))).toEqual([path]);
  });

  it("returns objects in requested-href order", async () => {
    const paths = objectPaths(5);
    const stub = installStub(createCalDAVServerStub({
      queryHrefs: paths,
      respond: (hrefs) => rowsFor(hrefs.toReversed()),
    }));

    const objects = await fetchObjects(stub);

    expect(objects.map((object) => new URL(object.url).pathname)).toEqual(paths);
  });
});
