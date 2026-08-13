import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVAuthenticationError, CalDAVClient } from "../../../../src/providers/caldav/shared/client";

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

const unauthorized = (challenge: string): Response =>
  new Response("<html>401</html>", {
    headers: { "content-type": "text/html", "www-authenticate": challenge },
    status: 401,
    statusText: "Unauthorized",
  });

const DIGEST_PARAMS = 'realm="caldav", qop="auth", nonce="dcd98b7102dd2f0e", opaque="5ccc069c"';
const DIGEST_ONLY = `Digest ${DIGEST_PARAMS}`;
const DIGEST_AFTER_NEGOTIATE = `Negotiate, Digest ${DIGEST_PARAMS}`;
const DIGEST_AFTER_BASIC = `Basic realm="caldav", Digest ${DIGEST_PARAMS}`;
const BASIC_ONLY = 'Basic realm="caldav"';

const principalResponse = (): Response =>
  multistatus(
    `<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
  );

const homeResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${PRINCIPAL_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>${HOME_PATH}</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`,
  );

const collectionEntry = (path: string, displayName: string): string =>
  `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${displayName}</d:displayname><cs:getctag>ctag-${displayName}</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`;

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

const ENTRIES = [collectionEntry(PERSONAL_PATH, "Personal"), collectionEntry(SHARED_PATH, "Shared")];

interface RecordedRequest {
  authorization: string;
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
let requestLog: RecordedRequest[] = [];

const serve = (responder: Responder): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const recorded: RecordedRequest = {
      authorization: new Headers(init?.headers).get("authorization") ?? "",
      method: init?.method ?? "GET",
      path: url.pathname,
    };
    requestLog.push(recorded);
    return await responder(recorded);
  }) as unknown as typeof globalThis.fetch;
};

const contentFor = (path: string): Response => {
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
    return multistatus(ENTRIES.join(""));
  }
  return supportedReportSetResponse(path);
};

const digestOnlyServer = (challenge: string): Responder => (request) => {
  if (!request.authorization.startsWith("Digest ")) {
    return Promise.resolve(unauthorized(challenge));
  }
  return Promise.resolve(contentFor(request.path));
};

const basicOnlyServer = (): Responder => (request) => {
  if (!request.authorization.startsWith("Basic ")) {
    return Promise.resolve(unauthorized(BASIC_ONLY));
  }
  return Promise.resolve(contentFor(request.path));
};

type Verdict =
  | { kind: "resolved"; names: string[] }
  | { kind: "rejected"; authenticationError: boolean; name: string };

const createClient = (authMethod?: "basic" | "digest"): CalDAVClient =>
  new CalDAVClient({
    authMethod,
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl: "https://caldav.example.test",
  });

const runDiscovery = async (client: CalDAVClient): Promise<Verdict> => {
  try {
    const calendars = await client.discoverCalendars();
    return { kind: "resolved", names: calendars.map(({ displayName }) => displayName).toSorted() };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      name: errorName(error),
    };
  }
};

const RESOLVED: Verdict = { kind: "resolved", names: ["Personal", "Shared"] };

beforeEach(() => {
  requestLog = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a server that advertises digest alongside another scheme", () => {
  it("negotiates digest when the challenge lists it first", async () => {
    serve(digestOnlyServer(DIGEST_ONLY));

    expect(await runDiscovery(createClient())).toEqual(RESOLVED);
  });

  it("negotiates digest when the challenge lists Negotiate before it", async () => {
    serve(digestOnlyServer(DIGEST_AFTER_NEGOTIATE));

    expect(await runDiscovery(createClient())).toEqual(RESOLVED);
  });

  it("negotiates digest when the challenge lists Basic before it", async () => {
    serve(digestOnlyServer(DIGEST_AFTER_BASIC));

    expect(await runDiscovery(createClient())).toEqual(RESOLVED);
  });

  it("reaches the same verdict on every repeated discovery against a multi-scheme challenge", async () => {
    serve(digestOnlyServer(DIGEST_AFTER_NEGOTIATE));
    const client = createClient();

    expect([
      await runDiscovery(client),
      await runDiscovery(client),
      await runDiscovery(client),
    ]).toEqual([RESOLVED, RESOLVED, RESOLVED]);
  });
});

describe("a stored authentication method that no longer matches the server", () => {
  it("does not report valid credentials as invalid when the server moved to digest", async () => {
    serve(digestOnlyServer(DIGEST_ONLY));

    const verdict = await runDiscovery(createClient("basic"));

    expect(verdict).not.toEqual(
      expect.objectContaining({ authenticationError: true }),
    );
  });

  it("does not report valid credentials as invalid when the server moved to basic", async () => {
    serve(basicOnlyServer());

    const verdict = await runDiscovery(createClient("digest"));

    expect(verdict).not.toEqual(
      expect.objectContaining({ authenticationError: true }),
    );
  });

  it("reports a method the caller can persist once negotiation has settled", async () => {
    serve(digestOnlyServer(DIGEST_ONLY));

    const client = createClient("basic");
    await runDiscovery(client);

    expect(client.getResolvedAuthMethod()).not.toBe("basic");
  });
});

describe("a server that only challenges for digest partway through discovery", () => {
  it("does not latch onto basic and read the later challenge as invalid credentials", async () => {
    serve((request) => {
      if (request.path === HOME_PATH && !request.authorization.startsWith("Digest ")) {
        return Promise.resolve(unauthorized(DIGEST_ONLY));
      }
      if (request.path === "/.well-known/caldav") {
        return Promise.resolve(new Response("", { status: 404 }));
      }
      return Promise.resolve(contentFor(request.path));
    });

    const verdict = await runDiscovery(createClient());

    expect(verdict).toEqual(RESOLVED);
  });
});

describe("a server that rejects the digest response", () => {
  it("still reports invalid credentials when the digest answer is refused", async () => {
    serve(() => Promise.resolve(unauthorized(DIGEST_ONLY)));

    expect(await runDiscovery(createClient())).toEqual({
      authenticationError: true,
      kind: "rejected",
      name: "CalDAVAuthenticationError",
    });
    expect(requestLog.length).toBeGreaterThan(0);
  });
});
