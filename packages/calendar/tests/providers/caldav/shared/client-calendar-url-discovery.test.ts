import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";
import { CalDAVDiscoveryError } from "../../../../src/providers/caldav/shared/calendar-discovery";

const ORIGIN = "https://calendar.example.test";
const PRINCIPAL_PATH = "/caldav/a1b2c3/user/";
const CALENDAR_PATH = "/caldav/f00dcafe/events/";
const EVENT_PATH = `${CALENDAR_PATH}event-1.ics`;

const XML_HEADERS = { "content-type": "text/xml;charset=UTF-8" };

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">${body}</D:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const emptyMultistatus = (): Response =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?><D:multistatus xmlns:D="DAV:"/>`, {
    headers: XML_HEADERS,
    status: 207,
    statusText: "Multi-Status",
  });

const unauthorized = (): Response =>
  new Response("<html>401</html>", {
    headers: { "content-type": "text/html", "www-authenticate": 'Basic realm="caldav"' },
    status: 401,
    statusText: "Unauthorized",
  });

const principalResponse = (href: string): Response =>
  multistatus(
    `<D:response><D:href>${href}</D:href><D:propstat><D:prop><D:current-user-principal><D:href>${PRINCIPAL_PATH}</D:href></D:current-user-principal></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
  );

const missingHomeSetResponse = (): Response =>
  multistatus(
    `<D:response><D:href>${PRINCIPAL_PATH}</D:href><D:propstat><D:prop><D:displayname>user</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
  );

const calendarCollectionResponse = (): Response =>
  multistatus(
    `<D:response><D:href>${CALENDAR_PATH}</D:href><D:propstat><D:prop><D:displayname>Work</D:displayname><CS:getctag>ctag-1</CS:getctag><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response><D:response><D:href>${EVENT_PATH}</D:href><D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
  );

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<D:response><D:href>${path}</D:href><D:propstat><D:prop><D:supported-report-set/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`,
  );

type HomeSetShape = "empty-multistatus" | "missing-property";

interface ServerOptions {
  homeSet: HomeSetShape;
  rejectCredentials: boolean;
}

interface RecordedRequest {
  body: string;
  depth: string | null;
  method: string;
  path: string;
}

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const readDepth = (init?: RequestInit): string | null => new Headers(init?.headers).get("depth");

const readBody = (init?: RequestInit): string => {
  if (typeof init?.body === "string") {
    return init.body;
  }
  return "";
};

const respond = (request: RecordedRequest, options: ServerOptions): Response => {
  if (options.rejectCredentials) {
    return unauthorized();
  }
  if (request.path === "/.well-known/caldav") {
    return new Response("", { headers: { location: "/caldav/" }, status: 301 });
  }
  if (request.path === "/caldav/" || request.path === "/") {
    return principalResponse(request.path);
  }
  if (request.path === PRINCIPAL_PATH) {
    if (options.homeSet === "empty-multistatus") {
      return emptyMultistatus();
    }
    return missingHomeSetResponse();
  }
  if (request.path === CALENDAR_PATH && request.depth === "0") {
    return calendarCollectionResponse();
  }
  return supportedReportSetResponse(request.path);
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let recorded: RecordedRequest[] = [];

const serve = (options: ServerOptions): void => {
  recorded = [];
  globalThis.fetch = ((input: string | Request | URL, init?: RequestInit) => {
    const request = {
      body: readBody(init),
      depth: readDepth(init),
      method: init?.method ?? "GET",
      path: requestUrl(input).pathname,
    };
    recorded.push(request);
    return Promise.resolve(respond(request, options));
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (serverUrl: string): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl,
  });

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV discovery on a server whose principal has no calendar home", () => {
  it.each<HomeSetShape>(["empty-multistatus", "missing-property"])(
    "lists the calendar at the entered URL when the home set is a %s",
    async (homeSet) => {
      serve({ homeSet, rejectCredentials: false });

      const calendars = await createClient(`${ORIGIN}${CALENDAR_PATH}`).discoverCalendars();

      expect(calendars).toEqual([
        expect.objectContaining({ displayName: "Work", url: `${ORIGIN}${CALENDAR_PATH}` }),
      ]);
    },
  );

  it("still fails discovery when the entered URL is not a calendar collection either", async () => {
    serve({ homeSet: "empty-multistatus", rejectCredentials: false });

    await expect(createClient(ORIGIN).discoverCalendars()).rejects.toBeInstanceOf(CalDAVDiscoveryError);
  });

  it("still reports invalid credentials instead of listing the entered URL", async () => {
    serve({ homeSet: "empty-multistatus", rejectCredentials: true });

    await expect(createClient(`${ORIGIN}${CALENDAR_PATH}`).discoverCalendars()).rejects.toBeInstanceOf(
      CalDAVAuthenticationError,
    );
    expect(recorded.some(({ body }) => body.includes("getctag"))).toBe(false);
  });
});
