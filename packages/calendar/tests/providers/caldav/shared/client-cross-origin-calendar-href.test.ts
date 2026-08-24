import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const HOST = "caldav.example.test";
const FOREIGN_HOST = "attacker.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const FOREIGN_CALENDAR_URL = `https://${FOREIGN_HOST}/stolen-calendar/`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const contentFor = (url: URL): Response => {
  if (url.pathname === "/.well-known/caldav") {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
  if (url.pathname === "/") {
    return multistatus(
      `<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
    );
  }
  if (url.pathname === PRINCIPAL_PATH) {
    return multistatus(
      `<d:response><d:href>${PRINCIPAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
    );
  }
  if (url.pathname === HOME_PATH) {
    return multistatus(
      `<d:response><d:href>${FOREIGN_CALENDAR_URL}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-1</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
    );
  }
  return multistatus(
    `<d:response><d:href>${url.pathname}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );
};

interface RecordedRequest {
  authorization: string;
  hostname: string;
  url: string;
}

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let requestLog: RecordedRequest[] = [];

beforeEach(() => {
  originalFetch = globalThis.fetch;
  requestLog = [];
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestLog.push({ authorization, hostname: url.hostname, url: url.href });
    await Promise.resolve();
    return contentFor(url);
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const discover = (): Promise<{ url: string }[]> =>
  new CalDAVClient({
    credentials: { password: "s3cret-caldav-pw", username: "victim@corp.com" },
    serverUrl: `https://${HOST}`,
  }).discoverCalendars();

describe("a CalDAV server that names a foreign origin in a calendar href", () => {
  it("never sends the account credentials to a host the user did not name", async () => {
    await discover();

    const credentialedForeignRequests = requestLog.filter(
      (request) => request.hostname !== HOST && request.authorization !== "",
    );

    expect(credentialedForeignRequests).toEqual([]);
  });

  it("does not return a calendar url pointing at a foreign origin", async () => {
    const calendars = await discover();

    expect(calendars.map(({ url }) => new URL(url).hostname)).toEqual([HOST]);
  });
});
