import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { serializeOutlookEvent } from "../../../src/providers/outlook/destination/serialize-event";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges } from "../../../src/core/sync-engine/types";
import type { MaterializedSyncableEvent, SyncOperation } from "../../../src/core/types";

const clientMocks = vi.hoisted(() => ({
  createCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
  deleteCalendarObjectByUrl: vi.fn(),
  fetchCalendarObject: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  fetchCalendarObjectsByUrls: vi.fn(),
  resolveCalendarUrl: vi.fn(),
  updateCalendarObjectByUrl: vi.fn(),
}));

vi.mock("../../../src/providers/caldav/shared/client", () => {
  class MockCalDAVHttpError extends Error {
    status: number;

    constructor(response: Response) {
      super(`CalDAV request failed: ${response.status} ${response.statusText}`.trim());
      this.name = "CalDAVHttpError";
      this.status = response.status;
    }
  }

  class MockCalDAVCreateConflictError extends MockCalDAVHttpError {
    constructor(response: Response) {
      super(response);
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
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPING_ID = "mapping-1";
const MIRROR_ITEM_ID = "AAMkAGthe-customers-live-mirror";
const MIRROR_UID = "mirror-uid-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* Graph really hands back TZIDs no IANA database knows - a mailbox configured with a custom rule
   reports "Customized Time Zone" - and normalize-timezone passes an unmapped label through
   verbatim, so the event reaches the serializer carrying a zone Intl cannot resolve. It is NOT
   recurring, so validate-recurrence-input never withholds it. */
const UNMAPPABLE_TIME_ZONE = "Customized Time Zone";

/* The customer edited their copy, so every cycle carries the same pending edit into the same
   serializer refusal, on the update verb and on the create verb alike. */
const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  startTimeZone: UNMAPPABLE_TIME_ZONE,
  summary: "Quarterly review — moved to Thursday",
};

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

interface MailboxEvent {
  categories: string[];
  end: { dateTime: string; timeZone: string };
  folderId: string;
  iCalUId: string;
  id: string;
  isAllDay: boolean;
  showAs: string;
  start: { dateTime: string; timeZone: string };
  subject: string;
}

const mirrorInTheMailbox = (): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId: DESTINATION_FOLDER_ID,
  iCalUId: MIRROR_UID,
  id: MIRROR_ITEM_ID,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject: "Quarterly review",
});

const readPathSegments = (url: URL): string[] =>
  url.pathname.split("/").filter((segment) => segment.length > 0);

const readDirectEventId = (url: URL): string | null => {
  const segments = readPathSegments(url);
  const eventsIndex = segments.lastIndexOf("events");
  if (eventsIndex === -1) {
    return null;
  }
  const identifier = segments[eventsIndex + 1];
  if (!identifier) {
    return null;
  }
  return decodeURIComponent(identifier);
};

const readAddressedFolderId = (url: URL): string => {
  const segments = readPathSegments(url);
  const calendarsIndex = segments.lastIndexOf("calendars");
  if (calendarsIndex === -1) {
    return DEFAULT_FOLDER_ID;
  }
  const folderId = segments[calendarsIndex + 1];
  if (!folderId) {
    return DEFAULT_FOLDER_ID;
  }
  return decodeURIComponent(folderId);
};

const isCalendarListRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.at(-1) === "calendars";
};

const readFilteredUid = (url: URL): string | null => {
  const filter = decodeURIComponent(url.searchParams.get("$filter") ?? "");
  const matched = /iCalUId eq '(?<uid>[^']*)'/u.exec(filter);
  const uid = matched?.groups?.["uid"];
  if (!uid) {
    return null;
  }
  return uid;
};

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

interface SyntheticMailbox {
  heldIds: () => string[];
  requests: GraphRequest[];
}

/* A synthetic Graph mailbox that behaves like the real one: DELETE on a present id really removes
   the object and answers 204, DELETE on an absent id answers 404, and POST really creates. Nothing
   here is kinder than Graph - if the engine issues the DELETE, the customer's only copy is gone. */
const installGraphMailbox = (): SyntheticMailbox => {
  const requests: GraphRequest[] = [];
  const held: MailboxEvent[] = [mirrorInTheMailbox()];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = readRequestBody(init);
    requests.push({ body, method, url: url.toString() });

    const directId = readDirectEventId(url);

    if (method === "DELETE") {
      const index = held.findIndex((event) => event.id === directId);
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => event.id === directId);
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const created: MailboxEvent = {
        ...mirrorInTheMailbox(),
        folderId: readAddressedFolderId(url),
        iCalUId: "created-uid",
        id: "AAMkAGcreated",
      };
      held.push(created);
      return Promise.resolve(Response.json(created));
    }

    if (isCalendarListRead(url)) {
      return Promise.resolve(Response.json({
        value: [{ id: DESTINATION_FOLDER_ID }, { id: DEFAULT_FOLDER_ID }],
      }));
    }

    if (directId) {
      const found = held.find((event) => event.id === directId);
      if (!found) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      return Promise.resolve(Response.json(found));
    }

    const folderId = readAddressedFolderId(url);
    const uid = readFilteredUid(url);
    const matched = held.filter((event) => event.folderId === folderId && event.iCalUId === uid);
    return Promise.resolve(Response.json({ value: matched }));
  }));

  return { heldIds: () => held.map((event) => event.id), requests };
};

const createOutlookProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    calendarId: DESTINATION_CALENDAR_ID,
    externalCalendarId: DESTINATION_FOLDER_ID,
    refreshToken: "test-refresh",
    userId: "user-1",
  });

const outlookMapping = (consecutiveUpdateFailures: number): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  consecutiveUpdateFailures,
  deleteIdentifier: MIRROR_ITEM_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const replacementFor = (mapping: EventMapping): Extract<SyncOperation, { type: "replace" }> => ({
  deleteId: mapping.deleteIdentifier,
  event: editedEvent,
  staleMappingId: mapping.id,
  type: "replace",
  uid: mapping.destinationEventUid,
});

interface OutlookCycle {
  carriedMapping: EventMapping;
  heldIds: string[];
  methods: string[];
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>;
}

/* The mapping as the next cycle would read it back: whatever the run wrote down, checkpointed or
   returned, applied on top of the row. */
const carryMappingForward = (
  mapping: EventMapping,
  outcome: Awaited<ReturnType<typeof executeRemoteOperations>>,
  checkpointed: PendingChanges[],
): EventMapping => {
  const written = [
    ...(outcome.changes.updates ?? []),
    ...checkpointed.flatMap((changes) => changes.updates ?? []),
  ].find((update) => update.id === mapping.id);
  if (!written) {
    return mapping;
  }
  return { ...mapping, ...written, id: mapping.id } as EventMapping;
};

const runOutlookCycle = async (priorFailures: number): Promise<OutlookCycle> => {
  const mailbox = installGraphMailbox();
  const mapping = outlookMapping(priorFailures);
  const checkpointed: PendingChanges[] = [];

  const outcome = await executeRemoteOperations(
    [replacementFor(mapping)],
    [mapping],
    DESTINATION_CALENDAR_ID,
    createOutlookProvider(),
    globalThis.undefined,
    globalThis.undefined,
    (changes: PendingChanges) => {
      checkpointed.push(changes);
      return Promise.resolve(true);
    },
  );

  return {
    carriedMapping: carryMappingForward(mapping, outcome, checkpointed),
    heldIds: mailbox.heldIds(),
    methods: mailbox.requests.map((request) => request.method),
    outcome,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("no delete-then-add unless the recreate can actually produce bytes", () => {
  /* The premise the whole promotion rests on: this failure is OURS, raised before any request
     left, and the create verb runs the very same serializer. There is no payload for a POST to
     carry, so a DELETE buys nothing but the loss of the live mirror. */
  it("refuses the same event on the create verb as on the update verb", () => {
    expect(() => serializeOutlookEvent(editedEvent)).toThrow(RangeError);
    expect(() => serializeOutlookEvent(editedEvent)).toThrow(/Unsupported calendar timezone/u);
  });

  for (const priorFailures of [0, 1]) {
    it(`issues no DELETE while the evidence is still only ${priorFailures} cycles old`, async () => {
      const cycle = await runOutlookCycle(priorFailures);

      expect(cycle.methods).not.toContain("DELETE");
      expect(cycle.methods).not.toContain("POST");
      expect(cycle.heldIds).toEqual([MIRROR_ITEM_ID]);
    });
  }

  it("never destroys the live mirror on the promotion cycle", async () => {
    const cycle = await runOutlookCycle(2);

    expect(cycle.methods).not.toContain("DELETE");
    expect(cycle.heldIds).toEqual([MIRROR_ITEM_ID]);
  });

  it("reports the failure instead of passing for a healthy run", async () => {
    const cycle = await runOutlookCycle(2);

    expect(cycle.outcome.result.addFailed).toBeGreaterThanOrEqual(1);
    expect(cycle.outcome.errors.some((entry) => entry.error.includes(MAPPING_ID))).toBe(true);
  });

  it("leaves the mapping naming the live id so a later cycle can retry", async () => {
    const cycle = await runOutlookCycle(2);

    expect(cycle.outcome.changes.deletes).not.toContain(MAPPING_ID);
    expect(cycle.carriedMapping.deleteIdentifier).toBe(MIRROR_ITEM_ID);
  });
});

const CALDAV_CALENDAR_URL = "https://caldav.example.invalid/calendars/user/shared/";
const CALDAV_MAPPING_ID = "caldav-map-1";

const movedMeeting: MaterializedSyncableEvent = {
  calendarId: "source-calendar-id",
  calendarName: "Source",
  calendarUrl: null,
  endTime: new Date("2026-03-15T10:00:00.000Z"),
  id: "event-state-id-1",
  sourceEventUid: "source-event-uid-1",
  startTime: new Date("2026-03-15T09:00:00.000Z"),
  summary: "Weekly standup, moved",
};

const caldavUid = generateDeterministicEventUid(movedMeeting.id);
/* A server that names objects itself: the stored basename can never match <uid>.ics again, so the
   update path can never address this object while the create path writes a DIFFERENT, correct
   href. Its create-side payload builds fine, so the gate must let this one through. */
const serverNamedObjectPath = "/calendars/user/shared/2f9c41d8-server-chosen.ics";

const createCalDAVProvider = () =>
  createCalDAVSyncProvider({
    authMethod: "basic",
    calendarUrl: CALDAV_CALENDAR_URL,
    password: "password",
    serverUrl: "https://caldav.example.invalid/",
    username: "user",
  });

const caldavMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: serverNamedObjectPath,
  destinationEventUid: caldavUid,
  endTime: movedMeeting.endTime,
  eventStateId: movedMeeting.id,
  id: CALDAV_MAPPING_ID,
  sourceCalendarId: "source-calendar-id",
  startTime: movedMeeting.startTime,
  syncEventHash: "stale-hash",
  syncEventId: movedMeeting.id,
});

const CALDAV_CYCLES = 3;

const runCalDAVCycles = async (): Promise<{ deletedMappingIds: string[]; insertedUids: string[] }> => {
  const deletedMappingIds: string[] = [];
  const insertedUids: string[] = [];
  let mapping: EventMapping | null = caldavMapping();

  for (let cycle = 0; cycle < CALDAV_CYCLES; cycle++) {
    if (!mapping) {
      continue;
    }
    const outcome = await executeRemoteOperations(
      [{
        deleteId: mapping.deleteIdentifier,
        event: movedMeeting,
        staleMappingId: mapping.id,
        type: "replace",
        uid: mapping.destinationEventUid,
      }],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createCalDAVProvider(),
    );

    deletedMappingIds.push(...outcome.changes.deletes);
    insertedUids.push(...outcome.changes.inserts.map((insert) => insert.destinationEventUid));

    if (outcome.changes.deletes.includes(mapping.id)) {
      mapping = null;
      continue;
    }
    const carriedId = mapping.id;
    const written = (outcome.changes.updates ?? []).find((update) => update.id === carriedId);
    mapping = { ...mapping, ...written, id: carriedId } as EventMapping;
  }

  return { deletedMappingIds, insertedUids };
};

describe("the CalDAV unaddressable-href escape still delete-then-adds", () => {
  beforeEach(() => {
    for (const mock of Object.values(clientMocks)) {
      mock.mockReset();
    }
    clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
    clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
    clientMocks.deleteCalendarObject.mockImplementation(() => Promise.resolve());
    clientMocks.deleteCalendarObjectByUrl.mockImplementation(() => Promise.resolve());
  });

  it("still promotes to a replacement because its create-side payload builds", async () => {
    const { deletedMappingIds, insertedUids } = await runCalDAVCycles();

    expect(clientMocks.createCalendarObject).toHaveBeenCalledTimes(1);
    expect(deletedMappingIds).toEqual([CALDAV_MAPPING_ID]);
    expect(insertedUids).toEqual([caldavUid]);
  });
});
