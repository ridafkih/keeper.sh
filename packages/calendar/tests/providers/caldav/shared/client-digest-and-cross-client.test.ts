import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CalDAVAuthenticationError,
  CalDAVClient,
} from "../../../../src/providers/caldav/shared/client";

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

const BASIC_CHALLENGE = 'Basic realm="caldav"';
const DIGEST_CHALLENGE = 'Digest realm="caldav", qop="auth", nonce="dcd98b7102dd2f0e", opaque="5ccc069c"';

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

const calendarListResponse = (entries: string[]): Response => multistatus(entries.join(""));

const supportedReportSetResponse = (path: string): Response =>
  multistatus(
    `<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

interface RecordedRequest {
  authorization: string;
  host: string;
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
      host: url.host,
      method: init?.method ?? "GET",
      path: url.pathname,
    };
    requestLog.push(recorded);
    return await responder(recorded);
  }) as unknown as typeof globalThis.fetch;
};

const settleAfter = async (ticks: number, response: Response): Promise<Response> => {
  for (let index = 0; index < ticks; index += 1) {
    await Promise.resolve();
  }
  return response;
};

const delayFor = (early: boolean): number => {
  if (early) {
    return 1;
  }
  return 7;
};

const createClient = (serverUrl: string): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "app-specific-password", username: "user@example.test" },
    serverUrl,
  });

type Verdict =
  | { kind: "resolved"; names: string[] }
  | { kind: "rejected"; authenticationError: boolean; name: string };

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

const AUTH_VERDICT: Verdict = {
  authenticationError: true,
  kind: "rejected",
  name: "CalDAVAuthenticationError",
};

const ENTRIES = [collectionEntry(PERSONAL_PATH, "Personal"), collectionEntry(SHARED_PATH, "Shared")];

interface HostBehaviour {
  denyEverything: boolean;
  ticks: number;
}

const routeForHost = (behaviour: HostBehaviour): Responder => (request) => {
  if (behaviour.denyEverything) {
    return settleAfter(behaviour.ticks, unauthorized(BASIC_CHALLENGE));
  }
  if (request.path === "/.well-known/caldav") {
    return settleAfter(behaviour.ticks, new Response("", { status: 404 }));
  }
  if (request.path === "/") {
    return settleAfter(behaviour.ticks, principalResponse());
  }
  if (request.path === PRINCIPAL_PATH) {
    return settleAfter(behaviour.ticks, homeResponse());
  }
  if (request.path === HOME_PATH) {
    return settleAfter(behaviour.ticks, calendarListResponse(ENTRIES));
  }
  return settleAfter(behaviour.ticks, supportedReportSetResponse(request.path));
};

const HEALTHY_HOST = "healthy.example.test";
const DENIED_HOST = "denied.example.test";

const twoAccountServer = (healthyTicks: number, deniedTicks: number): Responder => (request) => {
  if (request.host === DENIED_HOST) {
    return routeForHost({ denyEverything: true, ticks: deniedTicks })(request);
  }
  return routeForHost({ denyEverything: false, ticks: healthyTicks })(request);
};

beforeEach(() => {
  requestLog = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("two CalDAV accounts syncing at the same time", () => {
  it("does not let one account's 401 reach the other account's verdict", async () => {
    serve(twoAccountServer(6, 1));

    const [healthy, denied] = await Promise.all([
      runDiscovery(createClient(`https://${HEALTHY_HOST}`)),
      runDiscovery(createClient(`https://${DENIED_HOST}`)),
    ]);

    expect(healthy).toEqual({ kind: "resolved", names: ["Personal", "Shared"] });
    expect(denied).toEqual(AUTH_VERDICT);
  });

  it("gives the same pair of verdicts whichever account answers first", async () => {
    serve(twoAccountServer(1, 9));
    const deniedFirst = await Promise.all([
      runDiscovery(createClient(`https://${HEALTHY_HOST}`)),
      runDiscovery(createClient(`https://${DENIED_HOST}`)),
    ]);

    serve(twoAccountServer(9, 1));
    const healthyFirst = await Promise.all([
      runDiscovery(createClient(`https://${HEALTHY_HOST}`)),
      runDiscovery(createClient(`https://${DENIED_HOST}`)),
    ]);

    expect(deniedFirst).toEqual(healthyFirst);
  });

  it("keeps the healthy account healthy across repeated concurrent rounds", async () => {
    serve(twoAccountServer(4, 2));
    const healthyVerdicts: Verdict[] = [];

    for (let round = 0; round < 4; round += 1) {
      const [healthy] = await Promise.all([
        runDiscovery(createClient(`https://${HEALTHY_HOST}`)),
        runDiscovery(createClient(`https://${DENIED_HOST}`)),
      ]);
      healthyVerdicts.push(healthy);
    }

    expect(healthyVerdicts).toEqual(
      Array.from({ length: 4 }, () => ({ kind: "resolved", names: ["Personal", "Shared"] })),
    );
  });
});

describe("two operations racing on one CalDAV client", () => {
  it("does not blame the credentials for a read that ran beside a denied read", async () => {
    serve(twoAccountServer(6, 1));

    const client = createClient(`https://${HEALTHY_HOST}`);
    const denyingClient = createClient(`https://${DENIED_HOST}`);

    const [first, second, denied] = await Promise.all([
      runDiscovery(client),
      runDiscovery(client),
      runDiscovery(denyingClient),
    ]);

    expect(first).toEqual({ kind: "resolved", names: ["Personal", "Shared"] });
    expect(second).toEqual({ kind: "resolved", names: ["Personal", "Shared"] });
    expect(denied).toEqual(AUTH_VERDICT);
  });
});

const digestServer = (options: { acceptDigest: boolean }): Responder => (request) => {
  if (!request.authorization.startsWith("Digest ")) {
    return Promise.resolve(unauthorized(DIGEST_CHALLENGE));
  }
  if (!options.acceptDigest) {
    return Promise.resolve(unauthorized(DIGEST_CHALLENGE));
  }
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
    return Promise.resolve(calendarListResponse(ENTRIES));
  }
  return Promise.resolve(supportedReportSetResponse(request.path));
};

describe("a CalDAV server that answers a digest challenge before serving", () => {
  it("does not read the digest challenge as invalid credentials", async () => {
    serve(digestServer({ acceptDigest: true }));

    expect(await runDiscovery(createClient(`https://${HEALTHY_HOST}`))).toEqual({
      kind: "resolved",
      names: ["Personal", "Shared"],
    });
  });

  it("reaches the same verdict on every repeated discovery", async () => {
    serve(digestServer({ acceptDigest: true }));
    const client = createClient(`https://${HEALTHY_HOST}`);

    const verdicts = [
      await runDiscovery(client),
      await runDiscovery(client),
      await runDiscovery(client),
    ];

    expect(verdicts).toEqual(
      Array.from({ length: 3 }, () => ({ kind: "resolved", names: ["Personal", "Shared"] })),
    );
  });

  it("still reports invalid credentials when the digest response is rejected", async () => {
    serve(digestServer({ acceptDigest: false }));

    expect(await runDiscovery(createClient(`https://${HEALTHY_HOST}`))).toEqual(AUTH_VERDICT);
  });

  it("does not read a rotated nonce on concurrent collection probes as invalid credentials", async () => {
    const staleNonceServer = (sharedFirst: boolean): Responder => {
      const seen = new Set<string>();
      return (request) => {
        if (request.path === PERSONAL_PATH || request.path === SHARED_PATH) {
          const delay = delayFor((request.path === SHARED_PATH) === sharedFirst);
          if (!seen.has(request.path)) {
            seen.add(request.path);
            return settleAfter(
              delay,
              unauthorized('Digest realm="caldav", qop="auth", nonce="rotated-nonce"'),
            );
          }
          return settleAfter(delay, supportedReportSetResponse(request.path));
        }
        return digestServer({ acceptDigest: true })(request);
      };
    };

    serve(staleNonceServer(true));
    const sharedFirst = await runDiscovery(createClient(`https://${HEALTHY_HOST}`));

    serve(staleNonceServer(false));
    const personalFirst = await runDiscovery(createClient(`https://${HEALTHY_HOST}`));

    expect(sharedFirst).toEqual({ kind: "resolved", names: ["Personal", "Shared"] });
    expect(personalFirst).toEqual(sharedFirst);
  });
});
