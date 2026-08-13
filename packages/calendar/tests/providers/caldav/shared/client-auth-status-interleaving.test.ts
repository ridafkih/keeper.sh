import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
  CalDAVHttpError,
  CalDAVIncompleteMultiGetError,
} from "../../../../src/providers/caldav/shared/client";
import { isCalDAVAuthenticationError } from "../../../../src/providers/caldav/source/auth-error-classification";
import { RequestTimeoutError } from "../../../../src/core/utils/fetch-with-timeout";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;
const FIRST_OBJECT_PATH = `${CALENDAR_PATH}event-0001.ics`;
const SECOND_OBJECT_PATH = `${CALENDAR_PATH}event-0002.ics`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

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

const digestChallenge = (): Response =>
  new Response("<html>401</html>", {
    headers: {
      "content-type": "text/html",
      "www-authenticate": 'Digest realm="caldav", qop="auth", nonce="dcd98b7102dd2f0e", opaque="5ccc069c"',
    },
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

const etagResponse = (path: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${path}"</d:getetag></d:prop></d:propstat></d:response>`;

const calendarQueryResponse = (paths: string[]): Response =>
  multistatus(paths.map((path) => etagResponse(path)).join(""));

const icsFor = (uid: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTART:20260620T090000Z",
  "DTEND:20260620T100000Z",
  "SUMMARY:Standup",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const multigetEntry = (path: string, uid: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${path}"</d:getetag><c:calendar-data><![CDATA[${icsFor(uid)}]]></c:calendar-data></d:prop></d:propstat></d:response>`;

const multigetResponse = (entries: [string, string][]): Response =>
  multistatus(entries.map(([path, uid]) => multigetEntry(path, uid)).join(""));

interface RecordedRequest {
  authorization: string;
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

const isCalendarListing = (request: RecordedRequest): boolean =>
  request.method === "PROPFIND" && request.path === HOME_PATH;

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
  if (isCalendarListing(request)) {
    return Promise.resolve(calendarListResponse());
  }
  if (isCalendarQuery(request)) {
    return Promise.resolve(calendarQueryResponse([FIRST_OBJECT_PATH]));
  }
  if (isMultiGet(request)) {
    return Promise.resolve(multigetResponse([[FIRST_OBJECT_PATH, "event-0001"]]));
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
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      body: requestBody(init),
      method: init?.method ?? "GET",
      path: url.pathname,
      username: readUsername(init?.headers),
    };
    requests.push(recorded);
    return await responder(recorded);
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (username = "user@example.test"): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username },
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

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
};

const describeVerdict = (error: unknown): string => {
  if (error instanceof CalDAVAuthenticationError) {
    return "auth";
  }
  if (error instanceof CalDAVIncompleteMultiGetError) {
    return "incomplete";
  }
  if (error instanceof RequestTimeoutError) {
    return "timeout";
  }
  return `other:${errorName(error)}`;
};

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV auth attribution across interleaved and repeated operations", () => {
  it("keeps two operations on one client apart when their requests interleave", async () => {
    const release: (() => void)[] = [];
    const gate = new Promise<void>((resolve) => {
      release.push(resolve);
    });

    serve(async (request) => {
      if (isCalendarQuery(request)) {
        await gate;
        return unauthorized();
      }
      if (isCalendarListing(request)) {
        throw new RequestTimeoutError(90_000);
      }
      return healthyServer(request);
    });

    const client = createClient();
    const query = captureRejection(() =>
      client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));
    const listing = await captureRejection(() => client.discoverCalendars());

    release[0]?.();
    const queryResult = await query;

    expect(describeVerdict(listing)).toBe("timeout");
    expect(describeVerdict(queryResult)).toBe("auth");
  });

  it("does not report an empty calendar list when the calendar-home lookup is rejected with 401", async () => {
    serve((request) => {
      if (isCalendarListing(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const outcome = await createClient()
      .discoverCalendars()
      .then((calendars) => ({ calendars, rejected: null as unknown }))
      .catch((error: unknown) => ({ calendars: null, rejected: error }));

    expect(outcome.calendars).toBeNull();
    expect(outcome.rejected).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("does not silently accept credentials the server rejects at the calendar-home lookup", async () => {
    serve((request) => {
      if (isCalendarListing(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const client = createClient();
    const error = await captureRejection(() => client.resolveCalendarUrl(CALENDAR_URL));

    expect(describeVerdict(error)).toBe("auth");
  });

  it("does not blame credentials for an incomplete multiget that followed a 401 probe", async () => {
    serve((request) => {
      if (request.path === "/.well-known/caldav") {
        return Promise.resolve(unauthorized());
      }
      if (isCalendarQuery(request)) {
        return Promise.resolve(
          calendarQueryResponse([FIRST_OBJECT_PATH, SECOND_OBJECT_PATH]),
        );
      }
      if (isMultiGet(request)) {
        return Promise.resolve(multigetResponse([[FIRST_OBJECT_PATH, "event-0001"]]));
      }
      return healthyServer(request);
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(describeVerdict(error)).toBe("incomplete");
    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("recovers on the next run once the server stops rejecting the calendar-query", async () => {
    const state = { unauthorized: true };
    serve((request) => {
      if (state.unauthorized && isCalendarQuery(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const client = createClient();
    const first = await captureRejection(() =>
      client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    state.unauthorized = false;
    const second = await client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

    expect(describeVerdict(first)).toBe("auth");
    expect(second).toHaveLength(1);
  });

  it("converges rather than oscillating when the server flaps between 401 and healthy", async () => {
    const state = { unauthorized: false };
    serve((request) => {
      if (state.unauthorized && isCalendarQuery(request)) {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const client = createClient();
    const verdicts: string[] = [];
    for (const unauthorizedRun of [false, true, false, true, false]) {
      state.unauthorized = unauthorizedRun;
      const outcome = await client
        .fetchCalendarObjects({ calendarUrl: CALENDAR_URL })
        .then((objects) => `ok:${objects.length}`)
        .catch((error: unknown) => describeVerdict(error));
      verdicts.push(outcome);
    }

    expect(verdicts).toEqual(["ok:1", "auth", "ok:1", "auth", "ok:1"]);
  });

  it("reports an empty collection as empty even after a 401 well-known probe", async () => {
    serve((request) => {
      if (request.path === "/.well-known/caldav") {
        return Promise.resolve(unauthorized());
      }
      if (isCalendarQuery(request)) {
        return Promise.resolve(calendarQueryResponse([]));
      }
      return healthyServer(request);
    });

    const objects = await createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

    expect(objects).toEqual([]);
    expect(requests.some((request) => isMultiGet(request))).toBe(false);
  });

  it("settles on digest auth without reporting the challenge as invalid credentials", async () => {
    serve((request) => {
      if (!/^Digest\s/i.test(request.authorization)) {
        return Promise.resolve(digestChallenge());
      }
      return healthyServer(request);
    });

    const client = createClient();
    const first = await client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL });
    const resolvedAfterFirst = client.getResolvedAuthMethod();
    const second = await client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(resolvedAfterFirst).toBe("digest");
    expect(client.getResolvedAuthMethod()).toBe("digest");
  });

  it("does not blame credentials when a digest-authenticated request later times out", async () => {
    const state = { timeout: false };
    serve((request) => {
      if (!/^Digest\s/i.test(request.authorization)) {
        return Promise.resolve(digestChallenge());
      }
      if (state.timeout && isCalendarQuery(request)) {
        return Promise.reject(new RequestTimeoutError(90_000));
      }
      return healthyServer(request);
    });

    const client = createClient();
    await client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL });

    state.timeout = true;
    const error = await captureRejection(() =>
      client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(describeVerdict(error)).toBe("timeout");
    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });

  it("still classifies a 401 on a write as an authentication failure", async () => {
    serve((request) => {
      if (request.method === "PUT") {
        return Promise.resolve(unauthorized());
      }
      return healthyServer(request);
    });

    const error = await captureRejection(() =>
      createClient().createCalendarObject({
        calendarUrl: CALENDAR_URL,
        filename: "keeper-0001.ics",
        iCalString: icsFor("keeper-0001"),
      }));

    expect(error).toBeInstanceOf(CalDAVHttpError);
    expect(isCalDAVAuthenticationError(error)).toBe(true);
  });

  it("does not blame credentials for a 502 on a write that follows a 401 read", async () => {
    const state = { unauthorized: true };
    serve((request) => {
      if (state.unauthorized && isCalendarQuery(request)) {
        return Promise.resolve(unauthorized());
      }
      if (request.method === "PUT") {
        return Promise.resolve(new Response("<html>bad gateway</html>", {
          status: 502,
          statusText: "Bad Gateway",
        }));
      }
      return healthyServer(request);
    });

    const client = createClient();
    await captureRejection(() => client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));
    state.unauthorized = false;

    const error = await captureRejection(() =>
      client.createCalendarObject({
        calendarUrl: CALENDAR_URL,
        filename: "keeper-0001.ics",
        iCalString: icsFor("keeper-0001"),
      }));

    expect(error).toBeInstanceOf(CalDAVHttpError);
    expect(isCalDAVAuthenticationError(error)).toBe(false);
  });
});
