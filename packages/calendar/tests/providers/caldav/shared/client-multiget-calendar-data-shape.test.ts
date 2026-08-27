import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CalDAVObjectAnswer } from "../../../../src/providers/caldav/shared/client";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;
const OBJECT_PATH = `${CALENDAR_PATH}mirror-1.ics`;
const OBJECT_URL = `${SERVER_URL}${OBJECT_PATH}`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:mirror-1",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T100000Z",
  "SUMMARY:Design & <review>",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const ICS_SPLIT_AT = ICS.indexOf("BEGIN:VEVENT");

const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const CDATA_PAYLOAD = `<c:calendar-data><![CDATA[${ICS}]]></c:calendar-data>`;
const ESCAPED_PAYLOAD = `<c:calendar-data>${escapeXml(ICS)}</c:calendar-data>`;
const SPLIT_CDATA_PAYLOAD = `<c:calendar-data><![CDATA[${ICS.slice(0, ICS_SPLIT_AT)}]]><![CDATA[${ICS.slice(ICS_SPLIT_AT)}]]></c:calendar-data>`;

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const principalResponse = (): Response =>
  multistatus(
    `<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
  );

const homeResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${PRINCIPAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
  );

const calendarListResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${CALENDAR_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-1</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
  );

const supportedReportSetResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${CALENDAR_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

const foundResponse = (payload: string): Response =>
  multistatus(
    `<d:response><d:href>${OBJECT_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-1"</d:getetag>${payload}</d:prop></d:propstat></d:response>`,
  );

const goneResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${OBJECT_PATH}</d:href><d:propstat><d:status>HTTP/1.1 404 Not Found</d:status><d:prop><d:getetag/><c:calendar-data/></d:prop></d:propstat></d:response>`,
  );

const withheldBodyResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${OBJECT_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-1"</d:getetag></d:prop></d:propstat><d:propstat><d:status>HTTP/1.1 404 Not Found</d:status><d:prop><c:calendar-data/></d:prop></d:propstat></d:response>`,
  );

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const requestBody = (init?: RequestInit): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const serve = (responder: Responder): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) =>
    await responder({
      body: requestBody(init),
      method: init?.method ?? "GET",
      path: requestUrl(input).pathname,
    })) as unknown as typeof globalThis.fetch;
};

const scriptedServer = (multigetResponse: () => Response): Responder => (request) => {
  if (request.path === "/.well-known/caldav") {
    return Promise.resolve(new Response("", { status: 404 }));
  }
  if (request.path === "/") {
    return Promise.resolve(principalResponse());
  }
  if (request.path === PRINCIPAL_PATH) {
    return Promise.resolve(homeResponse());
  }
  if (request.path === HOME_PATH) {
    return Promise.resolve(calendarListResponse());
  }
  if (isMultiGet(request)) {
    return Promise.resolve(multigetResponse());
  }
  if (request.path === CALENDAR_PATH) {
    return Promise.resolve(supportedReportSetResponse());
  }
  return Promise.reject(new Error(`unhandled request ${request.method} ${request.path}`));
};

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

const verifyAgainst = async (multigetResponse: () => Response): Promise<CalDAVObjectAnswer[]> => {
  serve(scriptedServer(multigetResponse));
  return await createClient().verifyCalendarObjectsByUrls({
    calendarUrl: CALENDAR_URL,
    objectUrls: [OBJECT_URL],
  });
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("verification reading calendar-data of every serialisation a server may send", () => {
  it("reads an XML-escaped body as present", async () => {
    expect(await verifyAgainst(() => foundResponse(ESCAPED_PAYLOAD))).toEqual([
      { data: ICS, path: OBJECT_PATH, presence: "present" },
    ]);
  });

  it("reads a CDATA-wrapped body as present", async () => {
    expect(await verifyAgainst(() => foundResponse(CDATA_PAYLOAD))).toEqual([
      { data: ICS, path: OBJECT_PATH, presence: "present" },
    ]);
  });

  it("answers a CDATA-wrapped body identically to the XML-escaped form of the same ICS", async () => {
    const cdata = await verifyAgainst(() => foundResponse(CDATA_PAYLOAD));
    const escaped = await verifyAgainst(() => foundResponse(ESCAPED_PAYLOAD));

    expect(cdata).toEqual(escaped);
  });

  it("reads a body the parser split across CDATA sections whole", async () => {
    expect(await verifyAgainst(() => foundResponse(SPLIT_CDATA_PAYLOAD))).toEqual([
      { data: ICS, path: OBJECT_PATH, presence: "present" },
    ]);
  });

  it("still reports a 404 over the href as absent", async () => {
    expect(await verifyAgainst(goneResponse)).toEqual([
      { data: null, path: OBJECT_PATH, presence: "absent" },
    ]);
  });

  it("still reports a withheld calendar-data property as unknown", async () => {
    expect(await verifyAgainst(withheldBodyResponse)).toEqual([
      { data: null, path: OBJECT_PATH, presence: "unknown" },
    ]);
  });
});
