import { CryptoHasher } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalDAVAuthenticationError, CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const PERSONAL_PATH = "/cal/u/personal/";
const SHARED_PATH = "/cal/u/shared/";
const WORK_PATH = "/cal/u/work/";

const USERNAME = "user";
const PASSWORD = "correct-horse";
const REALM = "caldav";

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const errorName = (error: unknown): string => {
  if (error instanceof Error) {
    return error.name;
  }
  return typeof error;
};

const staleDirectiveFor = (stale: boolean): string => {
  if (stale) {
    return ", stale=true";
  }
  return "";
};

const md5 = (value: string): string => new CryptoHasher("md5").update(value).digest("hex");

const multistatus = (body: string): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${body}</d:multistatus>`,
    { headers: XML_HEADERS, status: 207, statusText: "Multi-Status" },
  );

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

const CALENDARS: [string, string][] = [
  [PERSONAL_PATH, "Personal"],
  [SHARED_PATH, "Shared"],
  [WORK_PATH, "Work"],
];

const contentFor = (path: string): Response => {
  if (path === "/.well-known/caldav") {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
  if (path === "/") {
    return principalResponse();
  }
  if (path === PRINCIPAL_PATH) {
    return homeResponse();
  }
  if (path === HOME_PATH) {
    return multistatus(CALENDARS.map(([url, name]) => collectionEntry(url, name)).join(""));
  }
  return supportedReportSetResponse(path);
};

const parseAuthParams = (header: string): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const [, key, quoted, bare] of header.matchAll(/([A-Za-z]+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    params[key ?? ""] = quoted ?? bare ?? "";
  }
  return params;
};

interface DigestServerOptions {
  checkNonceCount: boolean;
  password?: string;
  rotateNonceEvery?: number;
}

interface DigestServer {
  challengeCount: number;
  handle: (path: string, method: string, authorization: string) => Response;
  rejectedNonceCounts: string[];
}

const createStrictDigestServer = (options: DigestServerOptions): DigestServer => {
  const expectedPassword = options.password ?? PASSWORD;
  const seen = new Set<string>();
  const state = { challengeCount: 0, issued: 0, nonce: "nonce-0", served: 0 };
  const rejected: string[] = [];

  const challenge = (stale: boolean): Response => {
    state.challengeCount += 1;
    const staleDirective = staleDirectiveFor(stale);
    return new Response("<html>401</html>", {
      headers: {
        "content-type": "text/html",
        "www-authenticate": `Digest realm="${REALM}", qop="auth", nonce="${state.nonce}", opaque="op-1"${staleDirective}`,
      },
      status: 401,
      statusText: "Unauthorized",
    });
  };

  const rotate = (): void => {
    state.issued += 1;
    state.nonce = `nonce-${state.issued}`;
  };

  const handle = (path: string, method: string, authorization: string): Response => {
    if (!authorization.toLowerCase().startsWith("digest ")) {
      return challenge(false);
    }

    const params = parseAuthParams(authorization.slice("digest ".length));

    if (params.nonce !== state.nonce) {
      return challenge(true);
    }

    const key = `${params.nonce}:${params.nc}`;
    if (options.checkNonceCount && seen.has(key)) {
      rejected.push(key);
      rotate();
      return challenge(true);
    }
    seen.add(key);

    const hashA1 = md5(`${USERNAME}:${REALM}:${expectedPassword}`);
    const hashA2 = md5(`${method}:${params.uri ?? ""}`);
    const expected = md5(
      `${hashA1}:${params.nonce}:${params.nc}:${params.cnonce}:${params.qop}:${hashA2}`,
    );

    if (expected !== params.response) {
      return challenge(false);
    }

    state.served += 1;
    if (options.rotateNonceEvery && state.served % options.rotateNonceEvery === 0) {
      rotate();
    }

    return contentFor(path);
  };

  return {
    get challengeCount() {
      return state.challengeCount;
    },
    handle,
    get rejectedNonceCounts() {
      return rejected;
    },
  };
};

interface RecordedRequest {
  authorization: string;
  method: string;
  path: string;
}

const requestUrl = (input: string | Request | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(input.toString());
};

let originalFetch: typeof globalThis.fetch = globalThis.fetch;
let requestLog: RecordedRequest[] = [];

const serveDigest = (server: DigestServer, delayFor?: (path: string) => number): void => {
  globalThis.fetch = (async (input: string | Request | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    const method = init?.method ?? "GET";
    requestLog.push({ authorization, method, path: url.pathname });

    const ticks = delayFor?.(url.pathname) ?? 0;
    for (let index = 0; index < ticks; index++) {
      await Promise.resolve();
    }

    return server.handle(url.pathname, method, authorization);
  }) as unknown as typeof globalThis.fetch;
};

const createClient = (authMethod?: "basic" | "digest"): CalDAVClient =>
  new CalDAVClient({
    authMethod,
    credentials: { password: PASSWORD, username: USERNAME },
    serverUrl: SERVER_URL,
  });

const settle = async <Result>(
  operation: () => Promise<Result>,
): Promise<{ kind: "resolved"; value: Result } | { kind: "rejected"; name: string; authenticationError: boolean }> => {
  try {
    return { kind: "resolved", value: await operation() };
  } catch (error) {
    return {
      authenticationError: error instanceof CalDAVAuthenticationError,
      kind: "rejected",
      name: errorName(error),
    };
  }
};

const digestNonceCounts = (): string[] =>
  requestLog
    .filter(({ authorization }) => authorization.toLowerCase().startsWith("digest "))
    .map(({ authorization }) => parseAuthParams(authorization).nc ?? "");

beforeEach(() => {
  originalFetch = globalThis.fetch;
  requestLog = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV discovery against a digest server that enforces nonce counts", () => {
  it("never replays a nonce-count across the concurrent per-collection probes", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true });
    serveDigest(server);

    const outcome = await settle(() => createClient().discoverCalendars());

    const counts = digestNonceCounts();
    expect(new Set(counts).size).toBe(counts.length);
    expect(server.rejectedNonceCounts).toEqual([]);
    expect(outcome).toEqual({
      kind: "resolved",
      value: [
        { ctag: "ctag-Personal", displayName: "Personal", url: `${SERVER_URL}${PERSONAL_PATH}` },
        { ctag: "ctag-Shared", displayName: "Shared", url: `${SERVER_URL}${SHARED_PATH}` },
        { ctag: "ctag-Work", displayName: "Work", url: `${SERVER_URL}${WORK_PATH}` },
      ],
    });
  });

  it("does not report valid credentials as invalid when the probes are staggered", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true });
    const delays: Record<string, number> = {
      [PERSONAL_PATH]: 6,
      [SHARED_PATH]: 3,
      [WORK_PATH]: 0,
    };
    serveDigest(server, (path) => delays[path] ?? 0);

    const outcome = await settle(() => createClient().discoverCalendars());

    expect(outcome.kind).toBe("resolved");
  });

  it("converges instead of re-triggering a replay rejection on every repeated discovery", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true });
    serveDigest(server);
    const client = createClient();

    const first = await settle(() => client.discoverCalendars());
    const second = await settle(() => client.discoverCalendars());
    const third = await settle(() => client.discoverCalendars());

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(server.rejectedNonceCounts).toEqual([]);
  });

  it("does not spend a fresh challenge on every request once digest is negotiated", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true });
    serveDigest(server);
    const client = createClient();

    await settle(() => client.discoverCalendars());
    const challengesAfterFirst = server.challengeCount;
    await settle(() => client.discoverCalendars());

    expect(server.challengeCount - challengesAfterFirst).toBeLessThanOrEqual(1);
  });
});

describe("CalDAV discovery against a digest server that rotates its nonce", () => {
  it("converges on the rotated nonce instead of failing the account", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true, rotateNonceEvery: 2 });
    serveDigest(server);
    const client = createClient();

    const first = await settle(() => client.discoverCalendars());
    const second = await settle(() => client.discoverCalendars());

    expect(first.kind).toBe("resolved");
    expect(second.kind).toBe("resolved");
  });
});

describe("CalDAV discovery against a digest server with the wrong password", () => {
  it("still reports invalid credentials", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true, password: "rotated" });
    serveDigest(server);

    const outcome = await settle(() => createClient().discoverCalendars());

    expect(outcome).toMatchObject({ authenticationError: true, kind: "rejected" });
  });

  it("gives the same verdict on a repeated run", async () => {
    const server = createStrictDigestServer({ checkNonceCount: true, password: "rotated" });
    serveDigest(server);
    const client = createClient();

    const first = await settle(() => client.discoverCalendars());
    const second = await settle(() => client.discoverCalendars());

    expect(second).toEqual(first);
  });
});
