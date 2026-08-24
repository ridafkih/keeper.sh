import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CalDAVAuthenticationError, CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const davMocks = vi.hoisted(() => ({
  createDAVClient: vi.fn(),
}));

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: davMocks.createDAVClient,
}));

const SERVER_URL = "https://caldav.example.com";
const CALENDAR_URL = `${SERVER_URL}/cal/u/`;

type FetchFunction = (input: string | Request | URL, init?: RequestInit) => Promise<Response>;

class RequestTimeoutError extends Error {
  constructor() {
    super("Request timed out after 90000ms");
    this.name = "RequestTimeoutError";
  }
}

const unauthorized = (): Response => new Response("", { status: 401 });

const digestChallenge = (): Response =>
  new Response("", {
    status: 401,
    headers: { "www-authenticate": 'Digest realm="caldav", nonce="abc", qop="auth"' },
  });

const multistatus = (): Response => new Response("", { status: 207 });

type FetchStep = () => Promise<Response>;

const respondWith = (response: Response): FetchStep => () => Promise.resolve(response);

const throwTimeout: FetchStep = () => Promise.reject(new RequestTimeoutError());

let steps: FetchStep[] = [];
let originalFetch: typeof globalThis.fetch = globalThis.fetch;

const stubTransport = (transportSteps: FetchStep[]): void => {
  steps = [...transportSteps];
  globalThis.fetch = vi.fn(() => {
    const step = steps.shift();
    if (!step) {
      throw new Error("the transport ran out of scripted responses");
    }
    return step();
  }) as unknown as typeof globalThis.fetch;
};

interface DavClientCalls {
  fetchCalendars: (davFetch: FetchFunction) => Promise<unknown>;
  calendarQuery: (davFetch: FetchFunction) => Promise<{ href?: string }[]>;
  fetchCalendarObjects: (davFetch: FetchFunction) => Promise<{ url: string; data?: string }[]>;
}

const stubDavClient = (calls: Partial<DavClientCalls>): void => {
  davMocks.createDAVClient.mockImplementation(({ fetch: davFetch }: { fetch: FetchFunction }) =>
    Promise.resolve({
      calendarQuery: () => calls.calendarQuery?.(davFetch) ?? Promise.resolve([]),
      fetchCalendarObjects: () => calls.fetchCalendarObjects?.(davFetch) ?? Promise.resolve([]),
      fetchCalendars: () => calls.fetchCalendars?.(davFetch) ?? Promise.resolve([]),
    }));
};

const createClient = (): CalDAVClient =>
  new CalDAVClient({
    credentials: { password: "pass", username: "user" },
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

const drainResponse = async (response: Response): Promise<Response> => {
  await response.body?.cancel();
  return response;
};

beforeEach(() => {
  originalFetch = globalThis.fetch;
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV response status is scoped to the operation that produced it", () => {
  it("does not report a timed-out fetch as an authentication failure after an earlier 401", async () => {
    stubTransport([respondWith(unauthorized()), throwTimeout]);
    stubDavClient({
      calendarQuery: (davFetch) => davFetch(CALENDAR_URL).then(() => []),
      fetchCalendars: (davFetch) => davFetch(SERVER_URL).then(drainResponse).then(() => []),
    });

    const client = createClient();
    const discovery = await captureRejection(() => client.discoverCalendars());

    const error = await captureRejection(() => client.fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(discovery).toBeInstanceOf(CalDAVAuthenticationError);
    expect(error).not.toBeInstanceOf(CalDAVAuthenticationError);
    expect(error).toBeInstanceOf(RequestTimeoutError);
  });

  it("does not report a timed-out multiget as an authentication failure after a 401 earlier in the same operation", async () => {
    stubTransport([respondWith(unauthorized()), throwTimeout]);
    stubDavClient({
      calendarQuery: (davFetch) =>
        davFetch(CALENDAR_URL).then(drainResponse).then(() => [{ href: "/cal/u/event-0001.ics" }]),
      fetchCalendarObjects: (davFetch) => davFetch(CALENDAR_URL).then(() => []),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).not.toBeInstanceOf(CalDAVAuthenticationError);
    expect(error).toBeInstanceOf(RequestTimeoutError);
  });

  it("does not report a timed-out request as an authentication failure after a digest challenge", async () => {
    stubTransport([respondWith(digestChallenge()), throwTimeout]);
    stubDavClient({
      calendarQuery: (davFetch) => davFetch(CALENDAR_URL).then(() => []),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).not.toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("still reports a rejected operation whose own response was a 401 as an authentication failure", async () => {
    stubTransport([respondWith(unauthorized())]);
    stubDavClient({
      calendarQuery: (davFetch) =>
        davFetch(CALENDAR_URL).then(drainResponse).then(() => {
          throw new Error("Unauthorized");
        }),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("does not report a single-object read rejected with 401 as a missing object", async () => {
    stubTransport([respondWith(unauthorized())]);
    stubDavClient({
      fetchCalendarObjects: (davFetch) => davFetch(CALENDAR_URL).then(drainResponse).then(() => []),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObject({
        calendarUrl: CALENDAR_URL,
        filename: "keeper-0001.ics",
      }));

    expect(error).toBeInstanceOf(CalDAVAuthenticationError);
  });

  it("still reports a 401 raised after a successful earlier request as an authentication failure", async () => {
    stubTransport([respondWith(multistatus()), respondWith(unauthorized())]);
    stubDavClient({
      calendarQuery: (davFetch) =>
        davFetch(CALENDAR_URL).then(drainResponse).then(() => [{ href: "/cal/u/event-0001.ics" }]),
      fetchCalendarObjects: (davFetch) =>
        davFetch(CALENDAR_URL).then(drainResponse).then(() => {
          throw new Error("Unauthorized");
        }),
    });

    const error = await captureRejection(() =>
      createClient().fetchCalendarObjects({ calendarUrl: CALENDAR_URL }));

    expect(error).toBeInstanceOf(CalDAVAuthenticationError);
  });
});
