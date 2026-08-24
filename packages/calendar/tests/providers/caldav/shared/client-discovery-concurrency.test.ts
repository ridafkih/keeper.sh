import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";
import { createCalDAVSourceFetcher } from "../../../../src/providers/caldav/source/fetch-adapter";
import { createSourceIngestionPlan } from "../../../../src/core/sync/sync-range";
import { RequestTimeoutError } from "../../../../src/core/utils/fetch-with-timeout";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const PERSONAL_PATH = "/cal/u/personal/";
const SHARED_PATH = "/cal/u/shared/";

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

const collectionEntry = (path: string, displayName: string, component: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${displayName}</d:displayname><cs:getctag>ctag-${displayName}</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="${component}"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`;

const calendarListResponse = (entries: string[]): Response => multistatus(entries.join(""));

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const isCalendarQuery = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-query");

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

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown";
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const serve = (responder: Responder): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const recorded: RecordedRequest = {
      body: requestBody(init),
      method: init?.method ?? "GET",
      path: url.pathname,
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

const settleAfter = async (ticks: number, response: Response): Promise<Response> => {
  for (let index = 0; index < ticks; index += 1) {
    await Promise.resolve();
  }
  return response;
};

interface DiscoveryServerOptions {
  deniedPath: string;
  deniedTicks: number;
  entries: string[];
  healthyTicks: number;
}

const discoveryServer = (options: DiscoveryServerOptions): Responder => (request) => {
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
    return Promise.resolve(calendarListResponse(options.entries));
  }
  if (request.path === options.deniedPath) {
    return settleAfter(options.deniedTicks, unauthorized());
  }
  return settleAfter(options.healthyTicks, supportedReportSetResponse(request.path));
};

type Verdict = { kind: "resolved"; names: string[] } | { kind: "rejected"; name: string };

const runDiscovery = async (client: CalDAVClient): Promise<Verdict> => {
  try {
    const calendars = await client.discoverCalendars();
    return { kind: "resolved", names: calendars.map(({ displayName }) => displayName).toSorted() };
  } catch (error) {
    return { kind: "rejected", name: errorName(error) };
  }
};

const TWO_EVENT_CALENDARS = [
  collectionEntry(PERSONAL_PATH, "Personal", "VEVENT"),
  collectionEntry(SHARED_PATH, "Shared", "VEVENT"),
];

const EVENT_AND_TASK_COLLECTIONS = [
  collectionEntry(PERSONAL_PATH, "Personal", "VEVENT"),
  collectionEntry(SHARED_PATH, "Tasks", "VTODO"),
];

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV discovery when the home listing succeeds but a per-collection probe is denied", () => {
  it("reaches the per-collection probes concurrently, so their statuses share one operation", async () => {
    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 0,
      entries: TWO_EVENT_CALENDARS,
      healthyTicks: 0,
    }));

    await runDiscovery(createClient());

    const probePaths = requests
      .filter(({ path }) => path === PERSONAL_PATH || path === SHARED_PATH)
      .map(({ path }) => path);
    expect(probePaths).toHaveLength(2);
  });

  it("gives the same verdict whichever collection's probe answers last", async () => {
    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 8,
      entries: TWO_EVENT_CALENDARS,
      healthyTicks: 0,
    }));
    const deniedLast = await runDiscovery(createClient());

    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 0,
      entries: TWO_EVENT_CALENDARS,
      healthyTicks: 8,
    }));
    const deniedFirst = await runDiscovery(createClient());

    expect(deniedLast).toEqual(deniedFirst);
  });

  it("does not blame the credentials when only a task collection's probe is denied", async () => {
    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 8,
      entries: EVENT_AND_TASK_COLLECTIONS,
      healthyTicks: 0,
    }));

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual({ kind: "resolved", names: ["Personal"] });
  });

  it("converges on one verdict across repeated runs of the same client", async () => {
    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 8,
      entries: TWO_EVENT_CALENDARS,
      healthyTicks: 0,
    }));

    const client = createClient();
    const verdicts = [
      await runDiscovery(client),
      await runDiscovery(client),
      await runDiscovery(client),
      await runDiscovery(client),
    ];

    expect(new Set(verdicts.map((verdict) => JSON.stringify(verdict))).size).toBe(1);
  });
});

describe("a source ingest against a server with one denied collection", () => {
  it("does not report the customer's credentials as invalid", async () => {
    serve((request) => {
      if (isCalendarQuery(request)) {
        return Promise.resolve(multistatus(""));
      }
      return discoveryServer({
        deniedPath: SHARED_PATH,
        deniedTicks: 8,
        entries: TWO_EVENT_CALENDARS,
        healthyTicks: 0,
      })(request);
    });

    const fetcher = createCalDAVSourceFetcher({
      calendarUrl: `${SERVER_URL}${PERSONAL_PATH}`,
      password: "app-specific-password",
      plan: createSourceIngestionPlan("1_month", "1_month", new Date("2026-06-01T00:00:00.000Z")),
      serverUrl: SERVER_URL,
      username: "user@example.test",
    });

    const outcome = await fetcher
      .fetchEvents()
      .then(({ events }) => ({ kind: "resolved" as const, count: events.length }))
      .catch((error: unknown) => ({
        kind: "rejected" as const,
        name: errorName(error),
      }));

    expect(outcome).toEqual({ kind: "resolved", count: 0 });
  });
});

describe("a timeout racing a denied probe in the same discovery", () => {
  const timingOutServer = (deniedTicks: number, timeoutTicks: number): Responder => (request) => {
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
      return Promise.resolve(calendarListResponse(TWO_EVENT_CALENDARS));
    }
    if (request.path === SHARED_PATH) {
      return settleAfter(deniedTicks, unauthorized());
    }
    return settleAfter(timeoutTicks, new Response("", { status: 200 })).then(() => {
      throw new RequestTimeoutError(30_000);
    });
  };

  it("reports the timeout, not invalid credentials, when the denial lands first", async () => {
    serve(timingOutServer(0, 8));

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual({ kind: "rejected", name: "RequestTimeoutError" });
  });

  it("reports the timeout, not invalid credentials, when the denial lands last", async () => {
    serve(timingOutServer(8, 0));

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual({ kind: "rejected", name: "RequestTimeoutError" });
  });
});

describe("CalDAV discovery on collections that need no concurrent probe", () => {
  it("reports an empty calendar home as empty rather than as invalid credentials", async () => {
    serve(discoveryServer({
      deniedPath: SHARED_PATH,
      deniedTicks: 0,
      entries: [],
      healthyTicks: 0,
    }));

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual({ kind: "resolved", names: [] });
  });

  it("still blames the credentials when the only collection's probe is denied", async () => {
    serve(discoveryServer({
      deniedPath: PERSONAL_PATH,
      deniedTicks: 0,
      entries: [collectionEntry(PERSONAL_PATH, "Personal", "VEVENT")],
      healthyTicks: 0,
    }));

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual({ kind: "rejected", name: CalDAVAuthenticationError.name });
  });
});
