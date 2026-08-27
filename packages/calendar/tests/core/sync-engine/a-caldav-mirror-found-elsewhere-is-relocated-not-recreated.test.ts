import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

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
const DESTINATION_CALENDAR_ID = "dest-cal-relocated";
const MAPPING_ID = "map-relocated-1";
const EVENT_STATE_ID = "event-state-relocated-1";

const mirrorUid = generateDeterministicEventUid(EVENT_STATE_ID);

const mappedPath = `${CALENDAR_PATH}${mirrorUid}.ics`;

const relocatedPath = `${CALENDAR_PATH}20260917t090000z-3f81c0d4-server-assigned.ics`;

const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-09-17T10:00:00.000Z"),
  id: EVENT_STATE_ID,
  sourceEventUid: "source-event-uid-relocated",
  startTime: new Date("2026-09-17T09:00:00.000Z"),
  summary: "Design review moved to Thursday",
};

const laterEvent: MaterializedSyncableEvent = {
  ...editedEvent,
  summary: "Design review moved to Thursday afternoon",
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

const remoteObjects = new Map<string, string>();

const pathOf = (url: string): string => new URL(url, CALENDAR_URL).pathname;

const uidOfIcs = (ics: string): string =>
  ics.split("\r\n").find((line) => line.startsWith("UID:"))?.slice(4) ?? "";

const notFoundResponse = (): Response => new Response(null, { status: 404, statusText: "Not Found" });

const okResponse = (): Response => new Response(null, { status: 200, statusText: "OK" });

const uidConflictResponse = (): Response =>
  new Response(
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">',
      "<c:no-uid-conflict><d:href>",
      relocatedPath,
      "</d:href></c:no-uid-conflict>",
      "</d:error>",
    ].join(""),
    { status: 403, statusText: "Forbidden" },
  );

const conflictingPathFor = (path: string, ics: string): string | undefined => {
  const uid = uidOfIcs(ics);
  const holder = [...remoteObjects].find(([held, data]) => held !== path && uidOfIcs(data) === uid);
  return holder?.[0];
};

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

const filteredObjects = (body: unknown): [string, string][] => {
  const serialized = JSON.stringify(body ?? {});
  const named = [...remoteObjects].filter(([, data]) => serialized.includes(uidOfIcs(data)));
  if (named.length > 0) {
    return named;
  }
  return [...remoteObjects];
};

const answerReport = (body: unknown): string => {
  const hrefs = requestedHrefs(body);
  if (hrefs.length > 0) {
    return multiStatusXml(hrefs.map((href) => {
      const path = pathOf(href);
      const data = remoteObjects.get(path);
      if (!data) {
        return absentResponseXml(path);
      }
      return presentResponseXml(path, data);
    }).join(""));
  }

  return multiStatusXml(filteredObjects(body).map(([path, data]) => presentResponseXml(path, data)).join(""));
};

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
  davMocks.davRequest.mockImplementation(({ init }: { init: { body: unknown } }) =>
    Promise.resolve([{ ok: true, raw: answerReport(init.body), status: 207 }]));
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
      const path = pathOf(`${calendar.url}${filename}`);
      if (conflictingPathFor(path, iCalString)) {
        return Promise.resolve(uidConflictResponse());
      }
      remoteObjects.set(path, iCalString);
      return Promise.resolve(okResponse());
    },
  );
});

describe("a CalDAV mirror found elsewhere is relocated, not recreated", () => {
  it("creates nothing and deletes nothing when the object is alive under another href", async () => {
    const outcome = await runCycle(mappingNaming(mappedPath), editedEvent);

    expect(davMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(davMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(outcome.result.added).toBe(0);
    expect(outcome.result.removed).toBe(0);
    expect([...remoteObjects.keys()]).toEqual([relocatedPath]);
  });

  it("relocates the mapping onto the href the read located", async () => {
    const outcome = await runCycle(mappingNaming(mappedPath), editedEvent);

    const relocatedIdentifiers = (outcome.changes.updates ?? [])
      .filter((update) => update.id === MAPPING_ID)
      .map((update) => update.deleteIdentifier);
    expect(relocatedIdentifiers).toEqual([relocatedPath]);
    expect(outcome.changes.inserts).toEqual([]);
  });

  it("delivers the pending edit to the located object in the same run", async () => {
    await runCycle(mappingNaming(mappedPath), editedEvent);

    const writtenPaths = davMocks.updateCalendarObject.mock.calls.map((call) => {
      const [params] = call as [{ calendarObject: { url: string } }];
      return pathOf(params.calendarObject.url);
    });
    expect(writtenPaths).toContain(relocatedPath);
    expect(remoteObjects.get(relocatedPath)).toContain(`SUMMARY:${editedEvent.summary}`);
  });

  it("never promotes the located object into a delete-then-add on the next cycle", async () => {
    await runCycle(mappingNaming(mappedPath), editedEvent);
    davMocks.createCalendarObject.mockClear();
    davMocks.deleteCalendarObject.mockClear();

    const second = await runCycle(mappingNaming(relocatedPath), laterEvent);

    expect(davMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(davMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(second.result.added).toBe(0);
    expect(second.result.removed).toBe(0);
    expect([...remoteObjects.keys()]).toEqual([relocatedPath]);
    expect(remoteObjects.get(relocatedPath)).toContain(`SUMMARY:${laterEvent.summary}`);
  });
});
