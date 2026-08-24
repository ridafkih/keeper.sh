import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const PERSONAL_PATH = "/cal/u/personal/";

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

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
    `<d:response><d:href>${PERSONAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-Personal</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
  );

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const respond = (path: string): Response => {
  if (path === "/.well-known/caldav") {
    return new Response("", { status: 404 });
  }
  if (path === "/") {
    return principalResponse();
  }
  if (path === PRINCIPAL_PATH) {
    return homeResponse();
  }
  if (path === HOME_PATH) {
    return calendarListResponse();
  }
  return supportedReportSetResponse(path);
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV host-limiter charging during account discovery", () => {
  it("draws a permit before every origin request, including the discovery PROPFIND trio", async () => {
    let permitsDrawn = 0;
    let requestsSent = 0;
    const unchargedRequestPaths: string[] = [];

    globalThis.fetch = ((input: string | Request | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      requestsSent += 1;
      if (requestsSent > permitsDrawn) {
        unchargedRequestPaths.push(`${init?.method ?? "GET"} ${url.pathname}`);
      }
      return Promise.resolve(respond(url.pathname));
    }) as unknown as typeof globalThis.fetch;

    const client = new CalDAVClient({
      credentials: { password: "app-specific-password", username: "user@example.test" },
      onBeforeRequest: () => {
        permitsDrawn += 1;
      },
      serverUrl: SERVER_URL,
    });

    await client.discoverCalendars();

    expect(unchargedRequestPaths).toEqual([]);
  });
});
