import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* Inside a propstat the status describes the property, not the resource (RFC 4918 13.9): a server
   that holds the object but will not hand back its body files calendar-data under 404 while the
   same href carries a live getetag. Reading that as a missing object recreates an event the server
   just proved it still holds, which on a customer calendar is a permanent duplicate. Absence needs
   a 404 spoken about the href itself. */

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
  endTime: new Date("2026-05-12T10:00:00.000Z"),
  id,
  sourceEventUid: `source-event-uid-${id}`,
  startTime: new Date("2026-05-12T09:00:00.000Z"),
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

/* The object is there — the server answers its etag — and only its body is refused. */
const bodyRefusedResponse = (href: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:getetag>"etag-${href}"</d:getetag></d:prop></d:propstat><d:propstat><d:status>HTTP/1.1 404 Not Found</d:status><d:prop><c:calendar-data/></d:prop></d:propstat></d:response>`;

/* The href itself is gone: the server files the whole response under 404, props and all. */
const hrefGoneResponse = (href: string): string =>
  `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;

interface RecordedRequest {
  body: string;
  method: string;
  path: string;
}

type Responder = (request: RecordedRequest) => Promise<Response>;

const isMultiGet = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-multiget");

const isUidQuery = (request: RecordedRequest): boolean =>
  request.method === "REPORT" && request.body.includes("calendar-query");

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
  /* A real server answers a uid calendar-query, and this collection genuinely holds nothing under
     any other href - so it answers a well-formed empty multistatus. A double that refused the
     query instead would leave the uid unspoken for, which is not an absence and would suppress the
     recreate this fixture is about. */
  if (isUidQuery(request)) {
    return Promise.resolve(multistatus(""));
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
  };
};

beforeEach(() => {
  requests = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("a property 404 is not a missing object", () => {
  it("creates nothing when the server refuses the body of an href it still holds", async () => {
    serve(serveMultigetBody(bodyRefusedResponse(FIRST_PATH)));

    const outcome = await runReplacements([firstReplacement], [firstMapping]);

    expect(outcome.creates).toEqual([]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts).toEqual([]);
  });

  it("recreates only the href the server filed the whole response under 404 for", async () => {
    serve(
      serveMultigetBody(`${bodyRefusedResponse(FIRST_PATH)}${hrefGoneResponse(SECOND_PATH)}`),
    );

    const outcome = await runReplacements(
      [firstReplacement, secondReplacement],
      [firstMapping, secondMapping],
    );

    expect(outcome.creates).toEqual([SECOND_PATH]);
    expect(outcome.deletes).toEqual([]);
    expect(outcome.inserts.map((insert) => insert.deleteIdentifier)).toEqual([SECOND_PATH]);
  });
});
