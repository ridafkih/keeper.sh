import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The href the mapping stored answers 404 while the customer's event is alive in this same
   collection under a href the server chose. Only the UID search separates relocating the mapping
   from writing a permanent second copy - so what that search does when it cannot answer decides
   whether the customer keeps one event or two. A server that throws, and a server that cleanly
   answers 501 with no multistatus body, have both said nothing about the UID; neither may let the
   href's own 404 stand as a proven absence, because CalDAV's create is a PUT to the deterministic
   `${uid}.ics` href and no listing ever reaps the duplicate it lays down.

   The third case is the floor under the fix: a search that DID answer, found nothing, and was right
   must still create. 'Never say absent' would be a different bug wearing this test's name. */

/* Doubled at the wire, not at the client: the real CalDAVClient and the real destination provider
   both run here, so the UID search fails the way the product's own request would fail. */
const davMocks = vi.hoisted(() => ({
  calendarQuery: vi.fn(),
  createCalendarObject: vi.fn(),
  davRequest: vi.fn(),
  deleteCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendars: vi.fn(),
  updateCalendarObject: vi.fn(),
}));

vi.mock("tsdav", () => ({
  DAVNamespace: { CALDAV: "urn:ietf:params:xml:ns:caldav", DAV: "DAV:" },
  DAVNamespaceShort: { CALDAV: "c", DAV: "d" },
  getDAVAttribute: () => ({ "xmlns:c": "urn:ietf:params:xml:ns:caldav", "xmlns:d": "DAV:" }),
  createDAVClient: () => Promise.resolve({
    calendarQuery: davMocks.calendarQuery,
    createCalendarObject: davMocks.createCalendarObject,
    davRequest: davMocks.davRequest,
    deleteCalendarObject: davMocks.deleteCalendarObject,
    fetchCalendarObjects: davMocks.fetchCalendarObjects,
    fetchCalendars: davMocks.fetchCalendars,
    updateCalendarObject: davMocks.updateCalendarObject,
  }),
}));

const SERVER_URL = "https://caldav.example.com";
const CALENDAR_PATH = "/calendars/user/shared/";
const CALENDAR_URL = `${SERVER_URL}${CALENDAR_PATH}`;
const DESTINATION_CALENDAR_ID = "dest-cal-unanswered-uid";
const MAPPING_ID = "map-unanswered-uid-1";
const EVENT_STATE_ID = "event-state-unanswered-uid-1";

const mirrorUid = generateDeterministicEventUid(EVENT_STATE_ID);

/* The href keeper wrote to, and the href the mapping therefore holds. It is also the href a
   recreate would PUT to, which is why a duplicate here is a duplicate forever. */
const mappedPath = `${CALENDAR_PATH}${mirrorUid}.ics`;

const relocatedPath = `${CALENDAR_PATH}20260917t090000z-3f81c0d4-server-assigned.ics`;

const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-09-17T10:00:00.000Z"),
  id: EVENT_STATE_ID,
  sourceEventUid: "source-event-uid-unanswered",
  startTime: new Date("2026-09-17T09:00:00.000Z"),
  summary: "Design review moved to Thursday",
};

const icsFor = (summary: string): string => [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//keeper//sync//EN",
  "BEGIN:VEVENT",
  `UID:${mirrorUid}`,
  "DTSTAMP:20260901T120000Z",
  "DTSTART:20260917T090000Z",
  "DTEND:20260917T100000Z",
  `SUMMARY:${summary}`,
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const mappingNaming = (deleteIdentifier: string): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier,
  destinationEventUid: mirrorUid,
  endTime: editedEvent.endTime,
  eventStateId: EVENT_STATE_ID,
  id: MAPPING_ID,
  sourceCalendarId: "source-calendar-id",
  startTime: editedEvent.startTime,
  syncEventHash: "stale-hash",
  syncEventId: EVENT_STATE_ID,
});

const replacementFor = (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

const createProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALENDAR_URL,
    password: "password",
    serverUrl: SERVER_URL,
    username: "user",
  });

/* The customer's collection, keyed by href. */
const remoteObjects = new Map<string, string>();

const pathOf = (url: string): string => new URL(url, CALENDAR_URL).pathname;

const uidOfIcs = (ics: string): string =>
  ics.split(/\r?\n/u).find((line) => line.startsWith("UID:"))?.slice(4) ?? "";

/* The multiset of UIDs the collection holds. Counting keys alone would pass with two objects
   carrying one UID, which is the exact damage under test. */
const uidsInCollection = (): string[] => [...remoteObjects.values()].map((ics) => uidOfIcs(ics)).sort();

const notFoundResponse = (): Response => new Response(null, { status: 404, statusText: "Not Found" });

const okResponse = (): Response => new Response(null, { status: 200, statusText: "OK" });

const presentResponseXml = (path: string, data: string): string => [
  "<d:response>",
  `<d:href>${path}</d:href>`,
  "<d:propstat><d:prop>",
  `<d:getetag>"etag-${path}"</d:getetag>`,
  `<c:calendar-data>${data}</c:calendar-data>`,
  "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>",
  "</d:response>",
].join("");

const absentResponseXml = (path: string): string =>
  `<d:response><d:href>${path}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;

const multiStatusXml = (body: string): string =>
  `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;

const requestedHrefs = (body: unknown): string[] => {
  const multiGet = (body as Record<string, Record<string, unknown>>)["calendar-multiget"];
  if (!multiGet) {
    return [];
  }
  const hrefs = multiGet["d:href"];
  if (!Array.isArray(hrefs)) {
    return [];
  }
  return hrefs.map(String);
};

const isUidQuery = (body: unknown): boolean =>
  Boolean((body as Record<string, unknown> | undefined)?.["calendar-query"]);

/* A multiget is answered href by href - and the mapped href is answered 404 in every case here,
   because that 404 is the server's only true statement about it. */
const answerMultiGet = (body: unknown): string =>
  multiStatusXml(requestedHrefs(body).map((href) => {
    const path = pathOf(href);
    const data = remoteObjects.get(path);
    if (!data) {
      return absentResponseXml(path);
    }
    return presentResponseXml(path, data);
  }).join(""));

type Outcome = Awaited<ReturnType<typeof executeRemoteOperations>>;

const runCycle = async (
  mapping: EventMapping,
  event: MaterializedSyncableEvent,
): Promise<Outcome> =>
  await executeRemoteOperations(
    [replacementFor(mapping, event)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createProvider(),
  );

beforeEach(() => {
  for (const mock of Object.values(davMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();
  remoteObjects.set(relocatedPath, icsFor("Design review"));

  davMocks.fetchCalendars.mockResolvedValue([
    { components: ["VEVENT"], ctag: "ctag-1", displayName: "Shared", url: CALENDAR_URL },
  ]);
  davMocks.calendarQuery.mockImplementation(() =>
    Promise.resolve([...remoteObjects.keys()].map((path) => ({ href: path }))));
  davMocks.fetchCalendarObjects.mockImplementation(
    ({ objectUrls }: { objectUrls?: string[] }) =>
      Promise.resolve((objectUrls ?? [...remoteObjects.keys()]).flatMap((url) => {
        const path = pathOf(url);
        const data = remoteObjects.get(path);
        if (!data) {
          return [];
        }
        return [{ data, etag: `"etag-${path}"`, url: `${SERVER_URL}${path}` }];
      })),
  );
  davMocks.updateCalendarObject.mockImplementation(
    ({ calendarObject }: { calendarObject: { data: string; url: string } }) => {
      const path = pathOf(calendarObject.url);
      if (!remoteObjects.has(path)) {
        return Promise.resolve(notFoundResponse());
      }
      remoteObjects.set(path, calendarObject.data);
      return Promise.resolve(okResponse());
    },
  );
  davMocks.deleteCalendarObject.mockImplementation(
    ({ calendarObject }: { calendarObject: { url: string } }) => {
      if (!remoteObjects.delete(pathOf(calendarObject.url))) {
        return Promise.resolve(notFoundResponse());
      }
      return Promise.resolve(okResponse());
    },
  );
  davMocks.createCalendarObject.mockImplementation(
    ({ calendar, filename, iCalString }: {
      calendar: { url: string };
      filename: string;
      iCalString: string;
    }) => {
      remoteObjects.set(pathOf(`${calendar.url}${filename}`), iCalString);
      return Promise.resolve(okResponse());
    },
  );
});

describe("a CalDAV UID search that did not answer is never an absence", () => {
  it("creates nothing and deletes nothing when the UID REPORT throws", async () => {
    davMocks.davRequest.mockImplementation(({ init }: { init: { body: unknown } }) => {
      if (isUidQuery(init.body)) {
        return Promise.reject(new Error("socket hang up"));
      }
      return Promise.resolve([{ ok: true, raw: answerMultiGet(init.body), status: 207 }]);
    });

    const outcome = await runCycle(mappingNaming(mappedPath), editedEvent);

    expect(davMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(davMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
    expect([...remoteObjects.keys()]).toEqual([relocatedPath]);
    expect(uidsInCollection()).toEqual([mirrorUid]);
  });

  it("creates nothing and deletes nothing when the UID REPORT answers 501 with no body", async () => {
    davMocks.davRequest.mockImplementation(({ init }: { init: { body: unknown } }) => {
      if (isUidQuery(init.body)) {
        return Promise.resolve([{ ok: false, raw: "", status: 501 }]);
      }
      return Promise.resolve([{ ok: true, raw: answerMultiGet(init.body), status: 207 }]);
    });

    const outcome = await runCycle(mappingNaming(mappedPath), editedEvent);

    expect(davMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(davMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
    expect([...remoteObjects.keys()]).toEqual([relocatedPath]);
    expect(uidsInCollection()).toEqual([mirrorUid]);
  });

  /* The control: the search answered, found nothing, and the object really is gone. A real absence
     is still a real absence, so the mirror is recreated. */
  it("still creates when a well-formed empty multistatus proves the object gone", async () => {
    remoteObjects.clear();
    davMocks.davRequest.mockImplementation(({ init }: { init: { body: unknown } }) => {
      if (isUidQuery(init.body)) {
        return Promise.resolve([{ ok: true, raw: multiStatusXml(""), status: 207 }]);
      }
      return Promise.resolve([{ ok: true, raw: answerMultiGet(init.body), status: 207 }]);
    });

    const outcome = await runCycle(mappingNaming(mappedPath), editedEvent);

    expect(davMocks.createCalendarObject).toHaveBeenCalledTimes(1);
    expect(outcome.result.added).toBe(1);
    expect(uidsInCollection()).toEqual([mirrorUid]);
  });
});
