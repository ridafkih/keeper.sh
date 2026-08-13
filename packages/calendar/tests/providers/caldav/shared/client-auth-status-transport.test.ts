import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";
import { RequestTimeoutError } from "../../../../src/core/utils/fetch-with-timeout";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;
const OBJECT_PATH = `${CALENDAR_PATH}event-0001.ics`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const attributionOf = (error: unknown): string => {
  if (error instanceof CalDAVAuthenticationError) {
    return "auth";
  }
  return "transport";
};

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

const unauthorized = (): Response =>
  new Response("<html>401</html>", {
    headers: { "content-type": "text/html", "www-authenticate": 'Basic realm="caldav"' },
    status: 401,
    statusText: "Unauthorized",
  });

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

const calendarQueryResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${OBJECT_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-1"</d:getetag></d:prop></d:propstat></d:response>`,
  );

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:event-0001",
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T100000Z",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const multigetResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${OBJECT_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-1"</d:getetag><c:calendar-data><![CDATA[${ICS}]]></c:calendar-data></d:prop></d:propstat></d:response>`,
  );

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
  username: string;
}

const readUsername = (headers: RequestInit["headers"]): string => {
  const authorization = new Headers(headers).get("authorization") ?? "";
  const encoded = authorization.replace(/^Basic\s+/i, "");
  if (encoded === authorization) {
    return "";
  }
  return Buffer.from(encoded, "base64").toString().split(":")[0] ?? "";
};

type Responder = (request: RecordedRequest) => Promise<Response>;

const isCalendarQuery = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-query");

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

const healthyServer: Responder = (request) => {
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
  if (isCalendarQuery(request)) {
    return Promise.resolve(calendarQueryResponse());
  }
  if (isMultiGet(request)) {
    return Promise.resolve(multigetResponse());
  }
  if (request.path === CALENDAR_PATH) {
    return Promise.resolve(supportedReportSetResponse());
  }
  return Promise.reject(new Error(`unhandled request ${request.method} ${request.path}`));
};

let requests: RecordedRequest[] = [];

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
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const recorded: RecordedRequest = {
      body: requestBody(init),
      method: init?.method ?? "GET",
      path: url.pathname,
      username: readUsername(init?.headers),
    };
    requests.push(recorded);
    return await responder(recorded);
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

const captureRejection = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to reject");
};

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAVClient against a scripted CalDAV transport", () => {
  it("reports revoked credentials on the principal lookup as an authentication failure", async () => {
    serve((request) => {
      if (request.path === "/.well-known/caldav") {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(unauthorized());
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("reads a healthy collection end to end", async () => {
    serve(healthyServer);

    const objects = await createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

    expect(objects).toHaveLength(1);
    expect(objects[0]?.data).toContain("UID:event-0001");
  });

  it("does not blame credentials when the calendar-query times out after a 401 well-known probe", async () => {
    serve((request) => {
      if (request.path === "/.well-known/caldav") {
        return Promise.resolve(unauthorized());
      }
      if (isCalendarQuery(request)) {
        return Promise.reject(new RequestTimeoutError(90_000));
      }
      return healthyServer(request);
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect(error).not.toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("does not silently report an empty collection when the calendar-query is rejected with 401", async () => {
    serve((request) => {
      if (isCalendarQuery(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const outcome = await createClient()
      .fetchCalendarObjects({ calendarUrl: CALENDAR_URL })
      .then((objects) => ({ objects, rejected: null as unknown }))
      .catch((error: unknown) => ({ objects: null, rejected: error }));

    expect(outcome.objects).toBeNull();
    expect(outcome.rejected).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("does not silently report an empty collection when the multiget is rejected with 401", async () => {
    serve((request) => {
      if (isMultiGet(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("converges on the same verdict across repeated runs of one client", async () => {
    serve((request) => {
      if (isCalendarQuery(request)) {
        return Promise.reject(new RequestTimeoutError(90_000));
      }
      return healthyServer(request);
    });

    const client = createClient();
    const verdicts: string[] = [];
    for (let run = 0; run < 3; run++) {
      const error = await captureRejection(() =>
        client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));
      verdicts.push(attributionOf(error));
    }

    expect(verdicts).toEqual(["transport", "transport", "transport"]);
  });

  it("keeps two clients' verdicts apart when their requests interleave", async () => {
    const release: (() => void)[] = [];
    const gate = new Promise<void>((resolve) => {
      release.push(resolve);
    });

    serve(async (request) => {
      if (request.username === "timing-out-user") {
        if (isCalendarQuery(request)) {
          await gate;
          throw new RequestTimeoutError(90_000);
        }
        return healthyServer(request);
      }
      if (request.path === "/.well-known/caldav") {
        return healthyServer(request);
      }
      return unauthorized();
    });

    const unauthorizedClient = createClient();
    const timingOutClient = new CalDAVClient({
      credentials: { password: "pass", username: "timing-out-user" },
      serverUrl: SERVER_URL,
    });

    const timingOut = captureRejection(() =>
      timingOutClient.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    const unauthorizedResult = await captureRejection(() =>
      unauthorizedClient.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    release[0]?.();
    const timingOutResult = await timingOut;

    expect(unauthorizedResult).toBeInstanceOf(CalDAVAuthenticationError);
    expect(timingOutResult).toBeInstanceOf(RequestTimeoutError);
    expect(timingOutResult).not.toBeInstanceOf(CalDAVAuthenticationError);
  });
});
