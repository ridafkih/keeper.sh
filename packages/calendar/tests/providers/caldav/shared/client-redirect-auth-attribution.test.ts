import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVAuthenticationError, CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const HOST = "caldav.example.test";
const OTHER_HOST = "dav.other-provider.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";

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

const redirect = (location: string): Response =>
  new Response("", { headers: { location }, status: 301, statusText: "Moved Permanently" });

const contentFor = (path: string): Response => {
  if (path === "/.well-known/caldav") {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
  if (path === "/") {
    return multistatus(
      `<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
    );
  }
  if (path === PRINCIPAL_PATH) {
    return multistatus(
      `<d:response><d:href>${PRINCIPAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
    );
  }
  if (path === HOME_PATH) {
    return multistatus(
      `<d:response><d:href>${CALENDAR_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-1</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
    );
  }
  return multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );
};

interface RecordedRequest {
  authorization: string;
  url: string;
}

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let requestLog: RecordedRequest[] = [];

type Responder = (url: URL, authorization: string, init?: RequestInit) => Response;

const serve = (responder: Responder): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    requestLog.push({ authorization, url: url.href });
    await Promise.resolve();
    return responder(url, authorization, init);
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (serverUrl: string): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-password", username: "user" },
    serverUrl,
  });

const settle = async <Result>(
  operation: () => Promise<Result>,
): Promise<
  | { kind: "resolved"; value: Result }
  | { authenticationError: boolean; kind: "rejected"; message: string; name: string }
> => {
  try {
    return { kind: "resolved", value: await operation() };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      message: errorMessage(error),
      name: errorName(error),
    };
  }
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
  requestLog = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a CalDAV host that upgrades plain HTTP to HTTPS", () => {
  const upgradingServer: Responder = (url, authorization) => {
    if (url.protocol === "http:") {
      return redirect(`https://${HOST}${url.pathname}`);
    }
    if (!authorization) {
      return unauthorized();
    }
    return contentFor(url.pathname);
  };

  it("does not report valid credentials as invalid when the redirect drops our header", async () => {
    serve(upgradingServer);

    const outcome = await settle(() => createClient(`http://${HOST}`).discoverCalendars());

    expect(outcome).not.toMatchObject({ authenticationError: true });
  });

  it("reaches the same verdict on every repeated discovery", async () => {
    serve(upgradingServer);
    const client = createClient(`http://${HOST}`);

    const first = await settle(() => client.discoverCalendars());
    const second = await settle(() => client.discoverCalendars());

    expect(second).toEqual(first);
  });

  it("still reports invalid credentials when the upgraded host rejects the credentials it received", async () => {
    serve((url) => {
      if (url.protocol === "http:") {
        return redirect(`https://${HOST}${url.pathname}`);
      }
      return unauthorized();
    });

    const outcome = await settle(() => createClient(`https://${HOST}`).discoverCalendars());

    expect(outcome).toMatchObject({ authenticationError: true, kind: "rejected" });
  });
});

describe("a CalDAV host that redirects the principal lookup to another domain", () => {
  const relocatedServer: Responder = (url, authorization) => {
    if (url.hostname === HOST && url.pathname === PRINCIPAL_PATH) {
      return redirect(`https://${OTHER_HOST}${PRINCIPAL_PATH}`);
    }
    if (url.hostname === OTHER_HOST && !authorization) {
      return unauthorized();
    }
    return contentFor(url.pathname);
  };

  it("does not report valid credentials as invalid when the cross-domain hop drops our header", async () => {
    serve(relocatedServer);

    const outcome = await settle(() => createClient(`https://${HOST}`).discoverCalendars());

    expect(outcome).not.toMatchObject({ authenticationError: true });
  });
});
