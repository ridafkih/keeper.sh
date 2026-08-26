import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { createCalDAVSyncProvider } from "../../../src/providers/caldav/destination/provider";
import { CalDAVHttpError } from "../../../src/providers/caldav/shared/client";
import { eventToICalString } from "../../../src/providers/caldav/shared/ics";
import type { EventMapping } from "../../../src/core/events/mappings";
import type { PendingChanges, PendingUpdate } from "../../../src/core/sync-engine/types";
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
  verifyCalendarObjectsByUrls: vi.fn(),
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
    verifyCalendarObjectsByUrls = clientMocks.verifyCalendarObjectsByUrls;
  }

  return {
    CalDAVClient,
    CalDAVCreateConflictError: MockCalDAVCreateConflictError,
    CalDAVHttpError: MockCalDAVHttpError,
  };
});

/* Ten cycles is far past any bounded escape: the reproduction ran ten and the mapping was still
   silently stalled on the tenth. */
const CYCLES = 10;

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
const MAPPING_ID = "mapping-1";
const MIRROR_ITEM_ID = "AAMkAGmirror-still-there";
const MIRROR_UID = "mirror-uid-1";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

/* The customer edited their copy, so every cycle from now on carries the same pending edit into the
   same refusal. */
const editedEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
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

/* Graph's own refusal shape for a part of the payload only the PATCH carries: the update body sends
   an explicit "recurrence": null that the create body never contains, so the create verb was never
   offered these bytes and cannot be assumed to refuse them. */
const refusedPayload = (): Response =>
  Response.json(
    {
      error: {
        code: "ErrorInvalidRecurrence",
        message: "The recurrence property cannot be cleared on this event.",
      },
    },
    { status: 400 },
  );

interface MailboxOptions {
  refusePatch: boolean;
}

/* A synthetic Graph mailbox in which the mirror really is still there at its mapped id: a DELETE
   would destroy the customer's only copy and a POST would duplicate it permanently. */
const installGraphMailbox = (options: MailboxOptions): GraphRequest[] => {
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
      if (options.refusePatch) {
        return Promise.resolve(refusedPayload());
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

  return requests;
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

const outlookMapping = (): EventMapping => ({
  calendarId: DESTINATION_CALENDAR_ID,
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

interface CycleOutcome {
  carriedCounter: number | null;
  createdMirror: boolean;
  errors: { error: string }[];
  namesTheMapping: boolean;
}

/* The mapping as the next cycle would read it back: whatever the run wrote down, checkpointed or
   returned, applied on top of the row. */
const carryMappingForward = (mapping: EventMapping, updates: PendingUpdate[]): EventMapping => {
  const written = updates.find((update) => update.id === mapping.id);
  if (!written) {
    return mapping;
  }
  return { ...mapping, ...written, id: mapping.id };
};

const namesMapping = (errors: { error: string }[]): boolean =>
  errors.some((entry) => entry.error.includes(MAPPING_ID));

const runOutlookCycles = async (): Promise<{ cycles: CycleOutcome[]; requests: GraphRequest[] }> => {
  const requests = installGraphMailbox({ refusePatch: true });
  const cycles: CycleOutcome[] = [];
  let mapping = outlookMapping();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const checkpointed: PendingChanges[] = [];
    const before = requests.length;

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

    const written = [
      ...(outcome.changes.updates ?? []),
      ...checkpointed.flatMap((changes) => changes.updates ?? []),
    ];
    const madeRequests = requests.slice(before);
    cycles.push({
      carriedCounter: written.find((update) => update.id === MAPPING_ID)?.consecutiveUpdateFailures ?? null,
      createdMirror: madeRequests.some((request) => request.method === "POST"),
      errors: outcome.errors,
      namesTheMapping: namesMapping(outcome.errors),
    });
    mapping = carryMappingForward(mapping, written);
  }

  return { cycles, requests };
};

const methodsOf = (requests: GraphRequest[]): string[] =>
  requests.map((request) => request.method);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an update the destination durably refuses must not stall the mapping forever", () => {
  /* The in-code justification for treating a 400 as never durable is that the create verb carries
     the same bytes into the same refusal. On Graph it provably does not: the PATCH body carries
     three properties the POST body never sends. */
  it("sends bytes on the create verb that the update verb never sent", async () => {
    const requests = installGraphMailbox({ refusePatch: false });
    const provider = createOutlookProvider();

    await provider.pushEvents([editedEvent]);
    const { updateEvents } = provider;
    if (!updateEvents) {
      throw new TypeError("Expected the provider to expose updateEvents");
    }
    await updateEvents([{ deleteId: MIRROR_ITEM_ID, event: editedEvent }]);

    const posted = requests.find((request) => request.method === "POST");
    const patched = requests.find((request) => request.method === "PATCH");
    const postedBody = posted?.body;
    const patchedBody = patched?.body;
    expect(postedBody).toBeTypeOf("string");
    expect(patchedBody).toBeTypeOf("string");
    expect(postedBody).not.toEqual(patchedBody);
    if (typeof postedBody !== "string" || typeof patchedBody !== "string") {
      throw new TypeError("Expected both the create and the update request to carry a body");
    }

    const postedKeys = Object.keys(JSON.parse(postedBody) as Record<string, unknown>);
    const patchedKeys = Object.keys(JSON.parse(patchedBody) as Record<string, unknown>);
    for (const updateOnly of ["body", "location", "recurrence"]) {
      expect(patchedKeys).toContain(updateOnly);
      expect(postedKeys).not.toContain(updateOnly);
    }
  });

  it("accumulates evidence on the mapping when the same refusal repeats", async () => {
    const { cycles } = await runOutlookCycles();

    /* One repeated refusal is one observation; the second cycle has to know the first happened, or
       no amount of repetition can ever add up to anything. */
    expect(cycles[0]?.carriedCounter).toBe(1);
    expect(cycles[1]?.carriedCounter).toBe(2);
  });

  it("stops being a silent no-op within a bounded number of cycles", async () => {
    const { cycles } = await runOutlookCycles();

    const escaped = cycles.findIndex((cycle) => cycle.namesTheMapping || cycle.createdMirror);
    expect(escaped).toBeGreaterThanOrEqual(0);
    expect(escaped).toBeLessThan(CYCLES);
  });

  /* The escape may not be bought with the customer's event: the verification read finds the mirror
     alive at its mapped id, so nothing licenses a delete and nothing licenses a duplicate. */
  it("never deletes or duplicates a mirror the read finds still present", async () => {
    const { requests } = await runOutlookCycles();

    expect(methodsOf(requests).filter((method) => method === "DELETE")).toEqual([]);
    expect(methodsOf(requests).filter((method) => method === "POST")).toEqual([]);
    expect(methodsOf(requests).filter((method) => method === "PATCH").length).toBeGreaterThan(0);
  });
});

const CALDAV_CALENDAR_URL = "https://caldav.example.invalid/calendars/user/shared/";
const CALDAV_MAPPING_ID = "caldav-mapping-1";
const caldavUid = generateDeterministicEventUid(editedEvent.id);
const caldavObjectPath = `/calendars/user/shared/${caldavUid}.ics`;

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
  deleteIdentifier: caldavObjectPath,
  destinationEventUid: caldavUid,
  endTime: END_TIME,
  eventStateId: editedEvent.id,
  id: CALDAV_MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: "stale-hash",
  syncEventId: editedEvent.id,
});

const caldavHttpError = (status: number, statusText: string): Error =>
  new CalDAVHttpError(new Response(null, { status, statusText }), "update");

const runCalDAVCycles = async (): Promise<CycleOutcome[]> => {
  const cycles: CycleOutcome[] = [];
  let mapping = caldavMapping();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const checkpointed: PendingChanges[] = [];
    const outcome = await executeRemoteOperations(
      [{
        deleteId: mapping.deleteIdentifier,
        event: editedEvent,
        staleMappingId: mapping.id,
        type: "replace",
        uid: mapping.destinationEventUid,
      }],
      [mapping],
      DESTINATION_CALENDAR_ID,
      createCalDAVProvider(),
      globalThis.undefined,
      globalThis.undefined,
      (changes: PendingChanges) => {
        checkpointed.push(changes);
        return Promise.resolve(true);
      },
    );

    const written = [
      ...(outcome.changes.updates ?? []),
      ...checkpointed.flatMap((changes) => changes.updates ?? []),
    ];
    cycles.push({
      carriedCounter: written.find((update) => update.id === CALDAV_MAPPING_ID)?.consecutiveUpdateFailures ?? null,
      createdMirror: clientMocks.createCalendarObject.mock.calls.length > 0,
      errors: outcome.errors,
      namesTheMapping: outcome.errors.some((entry) => entry.error.includes(CALDAV_MAPPING_ID)),
    });
    const carriedId = mapping.id;
    const carried = written.find((update) => update.id === carriedId);
    mapping = { ...mapping, ...carried, id: carriedId };
  }

  return cycles;
};

describe("the CalDAV counterpart still refuses to trade a live object for an escape", () => {
  beforeEach(() => {
    for (const mock of Object.values(clientMocks)) {
      mock.mockReset();
    }
    clientMocks.resolveCalendarUrl.mockImplementation((url: string) => Promise.resolve(url));
    clientMocks.createCalendarObject.mockImplementation(() => Promise.resolve());
    clientMocks.deleteCalendarObject.mockImplementation(() => Promise.resolve());
    clientMocks.deleteCalendarObjectByUrl.mockImplementation(() => Promise.resolve());
    clientMocks.updateCalendarObjectByUrl.mockRejectedValue(caldavHttpError(400, "Bad Request"));
    /* The object the mapping names is alive on the server, and the multiget hands back its bytes. */
    clientMocks.verifyCalendarObjectsByUrls.mockImplementation(() => Promise.resolve([
      {
        data: eventToICalString(editedEvent, caldavUid),
        path: `${CALDAV_CALENDAR_URL}${caldavUid}.ics`,
        presence: "present",
      },
    ]));
  });

  it("accumulates evidence and escapes without ever touching the live object", async () => {
    const cycles = await runCalDAVCycles();

    expect(cycles[0]?.carriedCounter).toBe(1);
    expect(cycles[1]?.carriedCounter).toBe(2);

    const escaped = cycles.findIndex((cycle) => cycle.namesTheMapping);
    expect(escaped).toBeGreaterThanOrEqual(0);
    expect(escaped).toBeLessThan(CYCLES);

    expect(clientMocks.createCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObject).not.toHaveBeenCalled();
    expect(clientMocks.deleteCalendarObjectByUrl).not.toHaveBeenCalled();
  });
});
