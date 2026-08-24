import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVAuthenticationError, CalDAVClient } from "../../../../src/providers/caldav/shared/client";
import { RequestTimeoutError } from "../../../../src/core/utils/fetch-with-timeout";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;

const BATCH_SIZE = 250;

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

const objectPath = (index: number): string =>
  `${CALENDAR_PATH}event-${String(index).padStart(5, "0")}.ics`;

const icsFor = (index: number): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:event-${index}`,
    "DTSTART:20260620T090000Z",
    "DTEND:20260620T100000Z",
    "SUMMARY:Standup",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

const calendarQueryResponse = (count: number): Response =>
  multistatus(
    Array.from({ length: count }, (unused, index) =>
      `<d:response><d:href>${objectPath(index)}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${index}"</d:getetag></d:prop></d:propstat></d:response>`).join(""),
  );

const multigetResponseFor = (body: string): Response => {
  const hrefs = [...body.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi)].map(([, href]) => href ?? "");
  const objects = hrefs
    .filter((href) => href.endsWith(".ics"))
    .map((href) => {
      const index = Number(/event-(\d+)\.ics$/.exec(href)?.[1] ?? "0");
      return `<d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${index}"</d:getetag><c:calendar-data><![CDATA[${icsFor(index)}]]></c:calendar-data></d:prop></d:propstat></d:response>`;
    });
  return multistatus(objects.join(""));
};

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const isCalendarQuery = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-query");

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown";
};

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

let requests: RecordedRequest[] = [];
let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const serve = (responder: Responder): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const recorded: RecordedRequest = {
      body: requestBody(init),
      method: init?.method ?? "GET",
      path: requestUrl(input).pathname,
    };
    requests.push(recorded);
    return await responder(recorded);
  }) as unknown as typeof globalThis.fetch;
};

interface ServerOptions {
  hrefCount: number;
  multigetOutcome?: (batchIndex: number) => Response | Error | null;
  wellKnownUnauthorized?: boolean;
}

const outcomeAtBatch =
  (deniedIndex: number, outcome: () => Response | Error) =>
  (batchIndex: number): Response | Error | null => {
    if (batchIndex === deniedIndex) {
      return outcome();
    }
    return null;
  };

const scriptedServer = (options: ServerOptions): Responder => {
  let multigetCount = 0;

  return (request) => {
    if (request.path === "/.well-known/caldav") {
      if (options.wellKnownUnauthorized) {
        return Promise.resolve(unauthorized());
      }
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
      return Promise.resolve(calendarQueryResponse(options.hrefCount));
    }
    if (isMultiGet(request)) {
      const batchIndex = multigetCount;
      multigetCount += 1;
      const outcome = options.multigetOutcome?.(batchIndex) ?? null;
      if (outcome instanceof Error) {
        return Promise.reject(outcome);
      }
      if (outcome) {
        return Promise.resolve(outcome);
      }
      return Promise.resolve(multigetResponseFor(request.body));
    }
    if (request.path === CALENDAR_PATH) {
      return Promise.resolve(supportedReportSetResponse());
    }
    return Promise.reject(new Error(`unhandled request ${request.method} ${request.path}`));
  };
};

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

type Verdict =
  | { kind: "resolved"; count: number }
  | { kind: "rejected"; authenticationError: boolean; name: string };

const runRead = async (client: CalDAVClient): Promise<Verdict> => {
  try {
    const objects = await client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL });
    return { count: objects.length, kind: "resolved" };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      name: errorName(error),
    };
  }
};

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a multiget that spans several batches", () => {
  it("reads every object when all batches succeed", async () => {
    serve(scriptedServer({ hrefCount: BATCH_SIZE * 2 + 1 }));

    expect(await runRead(createClient())).toEqual({ count: BATCH_SIZE * 2 + 1, kind: "resolved" });
    expect(requests.filter((request) => isMultiGet(request))).toHaveLength(3);
  });

  it("reports credentials revoked partway through as an authentication failure", async () => {
    serve(scriptedServer({
      hrefCount: BATCH_SIZE * 2 + 1,
      multigetOutcome: outcomeAtBatch(1, unauthorized),
    }));

    expect(await runRead(createClient())).toEqual({
      authenticationError: true,
      kind: "rejected",
      name: "CalDAVAuthenticationError",
    });
  });

  it("does not blame the credentials when a later batch times out", async () => {
    serve(scriptedServer({
      hrefCount: BATCH_SIZE * 2 + 1,
      multigetOutcome: outcomeAtBatch(1, () => new RequestTimeoutError(30_000)),
      wellKnownUnauthorized: true,
    }));

    expect(await runRead(createClient())).toEqual({
      authenticationError: false,
      kind: "rejected",
      name: "RequestTimeoutError",
    });
  });

  it("stops at the denied batch instead of reporting a short object set", async () => {
    serve(scriptedServer({
      hrefCount: BATCH_SIZE * 2 + 1,
      multigetOutcome: outcomeAtBatch(0, unauthorized),
    }));

    expect(await runRead(createClient())).toEqual({
      authenticationError: true,
      kind: "rejected",
      name: "CalDAVAuthenticationError",
    });
    expect(requests.filter((request) => isMultiGet(request))).toHaveLength(1);
  });

  it("converges on the same verdict across repeated reads on one client", async () => {
    const verdicts: Verdict[] = [];
    const client = createClient();

    for (let round = 0; round < 4; round += 1) {
      serve(scriptedServer({
        hrefCount: BATCH_SIZE + 1,
        multigetOutcome: outcomeAtBatch(1, unauthorized),
      }));
      verdicts.push(await runRead(client));
    }

    expect(verdicts).toEqual(
      Array.from({ length: 4 }, () => ({
        authenticationError: true,
        kind: "rejected",
        name: "CalDAVAuthenticationError",
      })),
    );
  });

  it("keeps a healthy read healthy on every repeated round after a denied round", async () => {
    const client = createClient();

    serve(scriptedServer({
      hrefCount: BATCH_SIZE + 1,
      multigetOutcome: outcomeAtBatch(1, unauthorized),
    }));
    await runRead(client);

    serve(scriptedServer({ hrefCount: BATCH_SIZE + 1 }));
    const healthy = [await runRead(client), await runRead(client), await runRead(client)];

    expect(healthy).toEqual(
      Array.from({ length: 3 }, () => ({ count: BATCH_SIZE + 1, kind: "resolved" })),
    );
  });
});

describe("collection sizes at the edges of a batch", () => {
  it("reports an empty collection as empty even after a denied well-known probe", async () => {
    serve(scriptedServer({ hrefCount: 0, wellKnownUnauthorized: true }));

    expect(await runRead(createClient())).toEqual({ count: 0, kind: "resolved" });
    expect(requests.filter((request) => isMultiGet(request))).toHaveLength(0);
  });

  it("reads a single-object collection after a denied well-known probe", async () => {
    serve(scriptedServer({ hrefCount: 1, wellKnownUnauthorized: true }));

    expect(await runRead(createClient())).toEqual({ count: 1, kind: "resolved" });
  });

  it("reads a collection of exactly one full batch", async () => {
    serve(scriptedServer({ hrefCount: BATCH_SIZE }));

    expect(await runRead(createClient())).toEqual({ count: BATCH_SIZE, kind: "resolved" });
    expect(requests.filter((request) => isMultiGet(request))).toHaveLength(1);
  });

  it("reports a denied final batch of a full-batch-plus-one collection as an authentication failure", async () => {
    serve(scriptedServer({
      hrefCount: BATCH_SIZE + 1,
      multigetOutcome: outcomeAtBatch(1, unauthorized),
    }));

    expect(await runRead(createClient())).toEqual({
      authenticationError: true,
      kind: "rejected",
      name: "CalDAVAuthenticationError",
    });
  });
});
