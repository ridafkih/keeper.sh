import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The transport is the subject here: a multiget answers per href, and only a 404 for that href is
   proof the calendar no longer holds it. Every other answer — a refusal, a withheld body, an href
   the server never answered at all — is the server declining to say, so nothing may be recreated. */

const SERVER_URL = "https://caldav.example.test";
const PRINCIPAL_PATH = "/principals/user/";
const HOME_PATH = "/cal/u/";
const CALENDAR_PATH = "/cal/u/personal/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;

const XML_HEADERS = { "content-type": "text/xml; charset=utf-8" };

const createEvent = (id: string, summary: string): MaterializedSyncableEvent => ({
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-04-14T10:00:00.000Z"),
  id,
  sourceEventUid: `source-event-uid-${id}`,
  startTime: new Date("2026-04-14T09:00:00.000Z"),
  summary,
});

const firstEvent = createEvent("event-state-id-one", "Design review");
const secondEvent = createEvent("event-state-id-two", "Budget review");

const FIRST_UID = generateDeterministicEventUid(firstEvent.id);
const SECOND_UID = generateDeterministicEventUid(secondEvent.id);
const FIRST_PATH = `${CALENDAR_PATH}${FIRST_UID}.ics`;
const SECOND_PATH = `${CALENDAR_PATH}${SECOND_UID}.ics`;

const mappingFor = (
  event: MaterializedSyncableEvent,
  uid: string,
  objectPath: string,
): EventMapping => ({
  remoteAvailability: null,
  remoteContentHash: null,
  remoteEndTime: null,
  remoteStartTime: null,
  calendarId: "dest-cal-1",
  deleteIdentifier: objectPath,
  destinationEventUid: uid,
  endTime: event.endTime,
  eventStateId: event.id,
  id: `map-${event.id}`,
  sourceCalendarId: "source-calendar-id",
  startTime: event.startTime,
  syncEventHash: "stale-hash",
  syncEventId: event.id,
});

// The mirror is believed gone, which is the only route into the verification the spec governs.
const replacementFor = (
  event: MaterializedSyncableEvent,
  uid: string,
  objectPath: string,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: objectPath,
  event,
  remoteMissing: true,
  staleMappingId: `map-${event.id}`,
  type: "replace",
  uid,
});

const firstMapping = mappingFor(firstEvent, FIRST_UID, FIRST_PATH);
const secondMapping = mappingFor(secondEvent, SECOND_UID, SECOND_PATH);
const firstReplacement = replacementFor(firstEvent, FIRST_UID, FIRST_PATH);
const secondReplacement = replacementFor(secondEvent, SECOND_UID, SECOND_PATH);

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

const calendarListResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${CALENDAR_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>Personal</d:displayname><cs:getctag>ctag-1</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
  );

const supportedReportSetResponse = (): Response =>
  multistatus(
    `<d:response><d:href>${CALENDAR_PATH}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`,
  );

// A propstat carrying only a status is how a server answers an href it refuses or no longer holds.
const statusOnlyResponse = (href: string, status: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:status>${status}</d:status><d:prop><c:calendar-data/></d:prop></d:propstat></d:response>`;

const withheldDataResponse = (href: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${href}"</d:getetag></d:prop></d:propstat></d:response>`;

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

const discoveryServer: Responder = (request) => {
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
  if (request.path === CALENDAR_PATH && request.method !== "REPORT") {
    return Promise.resolve(supportedReportSetResponse());
  }
  if (request.method === "PUT") {
    return Promise.resolve(new Response("", { status: 201, statusText: "Created" }));
  }
  return Promise.reject(new Error(`unhandled request ${request.method} ${request.path}`));
};

const serveMultigetBody = (body: string): Responder => (request) => {
  if (isMultiGet(request)) {
    return Promise.resolve(multistatus(body));
  }
  return discoveryServer(request);
};

let requests: RecordedRequest[] = [];
let originalFetch: typeof globalThis.fetch = globalThis.fetch;

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

const writtenPaths = (method: string): string[] =>
  requests.filter((request) => request.method === method).map((request) => request.path);

const createProvider = () =>
  createCalDAVSyncProvider({
    calendarUrl: CALENDAR_URL,
    password: "app-specific-password",
    serverUrl: SERVER_URL,
    username: "user@example.test",
  });

const runReplacements = async (
  replacements: Extract<SyncOperation, { type: "replace" }>[],
  mappings: EventMapping[],
) => {
  const outcome = await executeRemoteOperations(
    replacements,
    mappings,
    "dest-cal-1",
    createProvider(),
  ).catch(() => null);

  return {
    creates: writtenPaths("PUT"),
    deletes: writtenPaths("DELETE"),
    inserts: outcome?.changes.inserts ?? [],
    multigets: requests.filter((request) => isMultiGet(request)).length,
  };
};

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CalDAV absence requires a per-response 404", () => {
  it("recreates the mirror the server answered 404 for", async () => {
    serve(serveMultigetBody(statusOnlyResponse(FIRST_PATH, "HTTP/1.1 404 Not Found")));

    const outcome = await runReplacements([firstReplacement], [firstMapping]);

    /* Two reads, for two different objects: one proves the old href is gone, and one records the
       form the destination stored for the replacement. CalDAV echoes nothing, so it owes both. */
    expect(outcome.multigets).toBe(2);
    expect(outcome.creates).toEqual([FIRST_PATH]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toHaveLength(1);
  });

  it("creates nothing when the server answers 403 for the href", async () => {
    serve(serveMultigetBody(statusOnlyResponse(FIRST_PATH, "HTTP/1.1 403 Forbidden")));

    const outcome = await runReplacements([firstReplacement], [firstMapping]);

    expect(outcome.multigets).toBe(1);
    expect(outcome.creates).toEqual([]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toEqual([]);
  });

  it("creates nothing when the server answers 507 for the href", async () => {
    serve(serveMultigetBody(statusOnlyResponse(FIRST_PATH, "HTTP/1.1 507 Insufficient Storage")));

    const outcome = await runReplacements([firstReplacement], [firstMapping]);

    expect(outcome.creates).toEqual([]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toEqual([]);
  });

  it("creates nothing when the server answers the href without calendar-data", async () => {
    serve(serveMultigetBody(withheldDataResponse(FIRST_PATH)));

    const outcome = await runReplacements([firstReplacement], [firstMapping]);

    expect(outcome.creates).toEqual([]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toEqual([]);
  });

  it("creates nothing for an href a truncated multiget never answered", async () => {
    // The server answered only the first href and stopped; the second was never spoken to.
    serve(serveMultigetBody(statusOnlyResponse(FIRST_PATH, "HTTP/1.1 404 Not Found")));

    const outcome = await runReplacements(
      [firstReplacement, secondReplacement],
      [firstMapping, secondMapping],
    );

    expect(outcome.creates).toEqual([FIRST_PATH]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts.map((insert) => insert.deleteIdentifier)).toEqual([FIRST_PATH]);
  });

  it("creates nothing when a truncated multiget answers no href at all", async () => {
    serve(serveMultigetBody(""));

    const outcome = await runReplacements(
      [firstReplacement, secondReplacement],
      [firstMapping, secondMapping],
    );

    expect(outcome.creates).toEqual([]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toEqual([]);
  });
});
