import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const SERVER_URL = "https://caldav.example.test";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;
const PRESENT_PATH = `${CALENDAR_PATH}present@keeper.sh.ics`;
const VANISHED_PATH = `${CALENDAR_PATH}vanished@keeper.sh.ics`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const icsFor = (uid: string): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTART:20261108T090000Z",
    "DTEND:20261108T100000Z",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const listedObject = (path: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag"</d:getetag></d:prop></d:propstat></d:response>`;

const returnedObject = (path: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag"</d:getetag><c:calendar-data><![CDATA[${icsFor(path)}]]></c:calendar-data></d:prop></d:propstat></d:response>`;

const objectWithStatus = (path: string, status: string): string =>
  `<d:response><d:href>${path}</d:href><d:status>HTTP/1.1 ${status}</d:status></d:response>`;

interface RecordedRequest {
  body: string;
  method: string;
}

type ObjectAnswer = (path: string) => string;

const answerPresentObjects =
  (absentAnswer: ObjectAnswer): ObjectAnswer =>
  (path) => {
    if (path === VANISHED_PATH) {
      return absentAnswer(path);
    }
    return returnedObject(path);
  };

const requestedHrefs = (body: string): string[] =>
  [...body.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/giu)].map(([, href]) => href ?? "");

const isCalendarQuery = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-query");

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const requestBody = (init?: RequestInit): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

const serve = (respond: (request: RecordedRequest) => Response): void => {
  globalThis.fetch = ((_input: string | Request | URL, init?: RequestInit) => {
    const recorded = { body: requestBody(init), method: init?.method ?? "GET" };
    return Promise.resolve(respond(recorded));
  }) as unknown as typeof globalThis.fetch;
};

const serveCalendar = (options: { listed: string[]; multiget: (body: string) => Response }): void => {
  serve((request) => {
    if (isCalendarQuery(request)) {
      return multistatus(options.listed.map((path) => listedObject(path)).join(""));
    }
    if (isMultiGet(request)) {
      return options.multiget(request.body);
    }
    throw new Error(`unhandled request ${request.method}`);
  });
};

const multigetAnswering = (answer: ObjectAnswer) => (body: string): Response =>
  multistatus(requestedHrefs(body).filter((href) => href.endsWith(".ics")).map((href) => answer(href)).join(""));

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

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
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a multiget naming an object the calendar no longer holds", () => {
  const notFound = (path: string): string => objectWithStatus(path, "404 Not Found");

  it("returns the objects that still exist when looking objects up by href", async () => {
    serveCalendar({ listed: [], multiget: multigetAnswering(answerPresentObjects(notFound)) });

    const objects = await createClient().fetchCalendarObjectsByUrls({
      calendarUrl: CALENDAR_URL,
      objectUrls: [PRESENT_PATH, VANISHED_PATH],
    });

    expect(pathsOf(objects)).toEqual([PRESENT_PATH]);
  });

  it("answers a single-object lookup with nothing instead of failing the calendar", async () => {
    serveCalendar({ listed: [], multiget: multigetAnswering(answerPresentObjects(notFound)) });

    const object = await createClient().fetchCalendarObject({
      calendarUrl: CALENDAR_URL,
      filename: "vanished@keeper.sh.ics",
    });

    expect(object).toBeNull();
  });

  it("reports a listed object that vanished before it was read as an incomplete read, not a missing calendar", async () => {
    serveCalendar({
      listed: [PRESENT_PATH, VANISHED_PATH],
      multiget: multigetAnswering(answerPresentObjects(notFound)),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toMatchObject({
      hrefsRequested: 2,
      missingHrefs: [VANISHED_PATH],
      name: "CalDAVIncompleteMultiGetError",
      objectsReturned: 1,
    });
  });

  it("still fails when the server refuses one of the objects for another reason", async () => {
    const serverError = (path: string): string => objectWithStatus(path, "500 Internal Server Error");
    serveCalendar({ listed: [], multiget: multigetAnswering(answerPresentObjects(serverError)) });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjectsByUrls({
        calendarUrl: CALENDAR_URL,
        objectUrls: [PRESENT_PATH, VANISHED_PATH],
      }));

    expect((error as Error).message).toMatch(/^Collection query failed: 500/u);
  });
});

describe("a multiget against a calendar that is gone", () => {
  it("keeps reporting the collection's own 404", async () => {
    serveCalendar({
      listed: [],
      multiget: () => new Response("<html>gone</html>", {
        headers: { "content-type": "text/html" },
        status: 404,
        statusText: "Not Found",
      }),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjectsByUrls({
        calendarUrl: CALENDAR_URL,
        objectUrls: [PRESENT_PATH],
      }));

    expect((error as Error).message).toMatch(/^Collection query failed: 404 Not Found/u);
  });
});
