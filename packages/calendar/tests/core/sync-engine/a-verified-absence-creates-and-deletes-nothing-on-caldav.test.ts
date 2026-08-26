import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { CalDAVHttpError } from "../../../src/providers/caldav/shared/client";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

/* The third destination this product writes to, on the one state its read can settle outright: the
   recipient really deleted the object, so the collection holds nothing at the href the mapping
   names and the multiget answers a per-response 404. That answer has already asked the only
   question a DELETE could have asked, and it came back "there is nothing there" - so the
   replacement is created on the read's word and no DELETE is issued at all. Spending one here is at
   best wasted and at worst aimed at an object nobody verified, and the mapping must end up naming
   the object the create actually wrote rather than the identifier the read just proved dead. */

/* At least as capable as the real client: the provider's update verb writes through
   updateCalendarObjectByUrl, its recreate writes through createCalendarObject, and it removes
   through both delete verbs, so a double missing any of them certifies whatever the missing verb
   would have done. */
const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendarObjectsByUrls: vi.fn(),
  resolveCalendarUrl: vi.fn(),
  updateCalendarObjectByUrl: vi.fn(),
  verifyCalendarObjectsByUrls: vi.fn(),
}));

vi.mock("../../../src/providers/caldav/shared/client", () => {
  class MockCalDAVHttpError extends Error {
    operation: string;

    status: number;

    constructor(response: Response, operation: string) {
      super(`CalDAV ${operation} failed: ${response.status} ${response.statusText}`.trim());
      this.name = "CalDAVHttpError";
      this.operation = operation;
      this.status = response.status;
    }
  }

  class MockCalDAVCreateConflictError extends MockCalDAVHttpError {
    constructor(response: Response, operation: string) {
      super(response, operation);
      this.name = "CalDAVCreateConflictError";
    }
  }

  class CalDAVClient {
    createCalendarObject = clientMocks.createCalendarObject;
    deleteCalendarObject = clientMocks.deleteCalendarObject;
    deleteCalendarObjectByUrl = clientMocks.deleteCalendarObjectByUrl;
    fetchCalendarObject = clientMocks.fetchCalendarObject;
    fetchCalendarObjects = clientMocks.fetchCalendarObjects;
    fetchCalendarObjectsByUrls = clientMocks.fetchCalendarObjectsByUrls;
    resolveCalendarUrl = clientMocks.resolveCalendarUrl;
    updateCalendarObjectByUrl = clientMocks.updateCalendarObjectByUrl;
    verifyCalendarObjectsByUrls = clientMocks.verifyCalendarObjectsByUrls;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const SERVER_URL = "https://caldav.example.com/";
const CALENDAR_URL = "https://caldav.example.com/calendars/user/shared/";
const DESTINATION_CALENDAR_ID = "dest-cal-absent";
const MAPPING_ID = "map-absent-1";
const EVENT_STATE_ID = "event-state-absent-1";

const mirrorUid = generateDeterministicEventUid(EVENT_STATE_ID);

/* The href the create writes to, which is what a listing would report for the new object. */
const createdObjectPath = `/calendars/user/shared/${mirrorUid}.ics`;
const createdObjectUrl = `https://caldav.example.com${createdObjectPath}`;

/* A mapping stored before path recording holds the bare UID rather than the href, which the
   provider still addresses - so the identifier the read proves dead is textually distinguishable
   from the path the recreate hands back. */
const STALE_DELETE_ID = mirrorUid;

const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-09-17T10:00:00.000Z"),
  id: EVENT_STATE_ID,
  sourceEventUid: "source-event-uid-absent",
  startTime: new Date("2026-09-17T09:00:00.000Z"),
  summary: "Design review, moved to Thursday",
};

const absentMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: STALE_DELETE_ID,
  destinationEventUid: mirrorUid,
  endTime: editedEvent.endTime,
  eventStateId: EVENT_STATE_ID,
  id: MAPPING_ID,
  sourceCalendarId: "source-calendar-id",
  startTime: editedEvent.startTime,
  syncEventHash: "stale-hash",
  syncEventId: EVENT_STATE_ID,
});

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
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

/* A synthetic stand-in for the customer's collection. It starts empty because the recipient
   deleted the mirror, which is the whole premise the read is about to prove. */
const remoteObjects = new Map<string, string>();

const notFound = (operation: "create" | "delete" | "update"): Error =>
  new CalDAVHttpError(new Response(null, { status: 404, statusText: "Not Found" }), operation);

type Outcome = Awaited<ReturnType<typeof executeRemoteOperations>>;

const runCycle = async (): Promise<Outcome> => {
  const mapping = absentMapping();
  return await executeRemoteOperations(
    [replacementFor(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createProvider(),
  );
};

const createdFilenames = (): string[] =>
  clientMocks.createCalendarObject.mock.calls.map((call) => {
    const [params] = call as [{ filename: string }];
    return params.filename;
  });

beforeEach(() => {
  for (const mock of Object.values(clientMocks)) {
    mock.mockReset();
  }
  remoteObjects.clear();

  clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
  clientMocks.updateCalendarObjectByUrl.mockImplementation(
    ({ iCalString, objectUrl }: { iCalString: string; objectUrl: string }) => {
      if (!remoteObjects.has(objectUrl)) {
        return Promise.reject(notFound("update"));
      }
      remoteObjects.set(objectUrl, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObjectByUrl.mockImplementation(
    ({ objectUrl }: { objectUrl: string }) => {
      if (!remoteObjects.delete(objectUrl)) {
        return Promise.reject(notFound("delete"));
      }
      return Promise.resolve();
    },
  );
  clientMocks.deleteCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      if (!remoteObjects.delete(`${calendarUrl}${filename}`)) {
        return Promise.reject(notFound("delete"));
      }
      return Promise.resolve();
    },
  );
  clientMocks.createCalendarObject.mockImplementation(
    ({ calendarUrl, filename, iCalString }: {
      calendarUrl: string;
      filename: string;
      iCalString: string;
    }) => {
      remoteObjects.set(`${calendarUrl}${filename}`, iCalString);
      return Promise.resolve();
    },
  );
  clientMocks.fetchCalendarObject.mockImplementation(
    ({ calendarUrl, filename }: { calendarUrl: string; filename: string }) => {
      const data = remoteObjects.get(`${calendarUrl}${filename}`);
      if (!data) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ data, etag: "\"etag-1\"", url: `${calendarUrl}${filename}` });
    },
  );
  clientMocks.fetchCalendarObjectsByUrls.mockImplementation(
    ({ objectUrls }: { objectUrls: string[] }) =>
      Promise.resolve(objectUrls.flatMap((url) => {
        const data = remoteObjects.get(url);
        if (!data) {
          return [];
        }
        return [{ data, url }];
      })),
  );
  /* Only the server's own per-response 404 is absence; anything it holds comes back with bytes. */
  clientMocks.verifyCalendarObjectsByUrls.mockImplementation(
    ({ objectUrls }: { objectUrls: string[] }) =>
      Promise.resolve(objectUrls.map((url) => {
        const data = remoteObjects.get(url);
        if (!data) {
          return { data: null, path: new URL(url).pathname, presence: "absent" };
        }
        return { data, path: new URL(url).pathname, presence: "present" };
      })),
  );
});

describe("a verified absence creates and deletes nothing on CalDAV", () => {
  it("issues no delete at all once the read has proved the object gone", async () => {
    const outcome = await runCycle();

    expect(clientMocks.verifyCalendarObjectsByUrls).toHaveBeenCalledTimes(1);
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(outcome.result.removed).toBe(0);
    expect(outcome.result.removeFailed).toBe(0);
  });

  it("creates the replacement exactly once", async () => {
    const outcome = await runCycle();

    expect(createdFilenames()).toEqual([`${mirrorUid}.ics`]);
    expect([...remoteObjects.keys()]).toEqual([createdObjectUrl]);
    expect(outcome.result.added).toBe(1);
  });

  it("leaves the mapping naming the object it created rather than the dead identifier", async () => {
    const outcome = await runCycle();

    const inserted = outcome.changes.inserts.map((insert) => insert.deleteIdentifier);
    expect(inserted).toEqual([createdObjectPath]);
    expect(inserted).not.toContain(STALE_DELETE_ID);
    expect(outcome.changes.deletes).toContain(MAPPING_ID);
  });
});
