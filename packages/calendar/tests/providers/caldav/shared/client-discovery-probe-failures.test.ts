import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";
import { RequestTimeoutError } from "../../../../src/core/utils/fetch-with-timeout";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const PERSONAL_PATH = "/cal/u/personal/";
const WELL_KNOWN_PATH = "/.well-known/caldav";

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
    `<d:response><d:href>${PERSONAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-1</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
  );

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

interface RecordedRequest {
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
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
    return await responder({ method: init?.method ?? "GET", path: url.pathname });
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: SERVER_URL,
  });

type DeniedPhase = "principal" | "home" | "none";

interface ServerOptions {
  denied: DeniedPhase;
  wellKnown: "not-found" | "timeout" | "reset";
}

const connectionReset = (): Error =>
  Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", name: "Error" });

const buildServer = (options: ServerOptions): Responder => (request) => {
  if (request.path === WELL_KNOWN_PATH) {
    if (options.wellKnown === "timeout") {
      return Promise.reject(new RequestTimeoutError(90_000));
    }
    if (options.wellKnown === "reset") {
      return Promise.reject(connectionReset());
    }
    return Promise.resolve(new Response("", { status: 404, statusText: "Not Found" }));
  }
  if (request.path === "/") {
    if (options.denied === "principal") {
      return Promise.resolve(unauthorized());
    }
    return Promise.resolve(principalResponse());
  }
  if (request.path === PRINCIPAL_PATH) {
    return Promise.resolve(homeResponse());
  }
  if (request.path === HOME_PATH) {
    if (options.denied === "home") {
      return Promise.resolve(unauthorized());
    }
    return Promise.resolve(calendarListResponse());
  }
  return Promise.resolve(supportedReportSetResponse(request.path));
};

type Verdict =
  | { kind: "resolved"; names: string[] }
  | { kind: "rejected"; authenticationError: boolean; name: string };

const runDiscovery = async (client: CalDAVClient): Promise<Verdict> => {
  try {
    const calendars = await client.discoverCalendars();
    return { kind: "resolved", names: calendars.map(({ displayName }) => displayName) };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      name: errorName(error),
    };
  }
};

const runQuery = async (client: CalDAVClient): Promise<Verdict> => {
  try {
    const objects = await client.fetchCalendarObjects({
      calendarUrl: `${SERVER_URL}${PERSONAL_PATH}`,
    });
    return { kind: "resolved", names: objects.map(({ url }) => url) };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      name: errorName(error),
    };
  }
};

const AUTH_VERDICT: Verdict = {
  authenticationError: true,
  kind: "rejected",
  name: "CalDAVAuthenticationError",
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV discovery when the service-discovery probe never answers", () => {
  it("reports invalid credentials when the principal lookup is denied", async () => {
    serve(buildServer({ denied: "principal", wellKnown: "not-found" }));

    expect(await runDiscovery(createClient())).toEqual(AUTH_VERDICT);
  });

  it("still reports invalid credentials when the well-known probe timed out", async () => {
    serve(buildServer({ denied: "principal", wellKnown: "timeout" }));

    expect(await runDiscovery(createClient())).toEqual(AUTH_VERDICT);
  });

  it("still reports invalid credentials when the well-known probe reset the connection", async () => {
    serve(buildServer({ denied: "principal", wellKnown: "reset" }));

    expect(await runDiscovery(createClient())).toEqual(AUTH_VERDICT);
  });

  it("gives the same verdict whichever phase the server denies", async () => {
    serve(buildServer({ denied: "principal", wellKnown: "timeout" }));
    const atPrincipal = await runDiscovery(createClient());

    serve(buildServer({ denied: "home", wellKnown: "timeout" }));
    const atHome = await runDiscovery(createClient());

    expect(atPrincipal).toEqual(atHome);
  });

  it("keeps the same verdict across repeated runs against an unreachable probe", async () => {
    serve(buildServer({ denied: "principal", wellKnown: "timeout" }));

    const verdicts = [
      await runDiscovery(createClient()),
      await runDiscovery(createClient()),
      await runDiscovery(createClient()),
    ];

    expect(verdicts).toEqual([AUTH_VERDICT, AUTH_VERDICT, AUTH_VERDICT]);
  });

  it("converges on the same verdict as the probe flaps between unreachable and healthy", async () => {
    const verdicts: Verdict[] = [];

    for (const wellKnown of ["not-found", "timeout", "not-found", "timeout"] as const) {
      serve(buildServer({ denied: "principal", wellKnown }));
      verdicts.push(await runDiscovery(createClient()));
    }

    expect(verdicts).toEqual([AUTH_VERDICT, AUTH_VERDICT, AUTH_VERDICT, AUTH_VERDICT]);
  });

  it("still discovers calendars when only the well-known probe is unreachable", async () => {
    serve(buildServer({ denied: "none", wellKnown: "timeout" }));

    expect(await runDiscovery(createClient())).toEqual({
      kind: "resolved",
      names: ["Personal"],
    });
  });

  it("still reports invalid credentials on a calendar query after an unreachable probe", async () => {
    const buildQueryServer = (wellKnown: ServerOptions["wellKnown"]): Responder => (request) => {
      if (request.method === "REPORT") {
        return Promise.resolve(unauthorized());
      }
      return buildServer({ denied: "none", wellKnown })(request);
    };

    serve(buildQueryServer("not-found"));
    const reachableProbe = await runQuery(createClient());

    serve(buildQueryServer("timeout"));
    const unreachableProbe = await runQuery(createClient());

    expect(reachableProbe).toEqual(AUTH_VERDICT);
    expect(unreachableProbe).toEqual(reachableProbe);
  });

  it("reports a timeout as a timeout when the calendar listing itself never answers", async () => {
    serve((request) => {
      if (request.path === HOME_PATH) {
        return Promise.reject(new RequestTimeoutError(90_000));
      }
      return buildServer({ denied: "none", wellKnown: "not-found" })(request);
    });

    expect(await runDiscovery(createClient())).toEqual({
      authenticationError: false,
      kind: "rejected",
      name: "RequestTimeoutError",
    });
  });
});
