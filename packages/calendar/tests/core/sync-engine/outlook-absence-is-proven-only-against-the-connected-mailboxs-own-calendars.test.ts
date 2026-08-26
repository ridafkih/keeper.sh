import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../src/providers/outlook/destination/provider";
import { executeRemoteOperations } from "../../../src/core/sync-engine/index";
import { computeSyncOperations } from "../../../src/core/sync/operations";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { MaterializedSyncableEvent } from "../../../src/core/types";
import type { PendingChanges, PendingUpdate } from "../../../src/core/sync-engine/types";
import type { EventMapping } from "../../../src/core/events/mappings";

const DESTINATION_CALENDAR_ID = "cal-1";
const DESTINATION_FOLDER_ID = "external-cal-1";
const DEFAULT_FOLDER_ID = "the-mailbox-default-calendar";
/* /me/calendars also hands back calendars a colleague shared or delegated to this account. The
   sync can neither read nor write another mailbox's items through /me. */
const FOREIGN_FOLDER_ID = "a-colleagues-shared-calendar";

const CONNECTED_MAILBOX_ADDRESS = "owner@example.com";
const COLLEAGUE_ADDRESS = "colleague@example.com";

const START_TIME = new Date("2026-09-01T15:00:00.000Z");
const END_TIME = new Date("2026-09-01T16:00:00.000Z");

const MAPPED_ID = "AAMkAGmirror-as-mapped";
/* The colleague's own copy of the meeting: same uid, an item id that only their mailbox can
   address, and never a thing this sync may write onto the mapping. */
const FOREIGN_COPY_ID = "AAMkAGcopy-living-in-the-colleagues-mailbox";
const MIRROR_UID = "mirror-uid-1";
const MAPPING_ID = "mapping-1";

const MAPPED_SUBJECT = "Quarterly review";
const EDITED_SUBJECT = "Quarterly review — moved to Thursday";

const FOLDER_OWNERS: Record<string, string> = {
  [DEFAULT_FOLDER_ID]: CONNECTED_MAILBOX_ADDRESS,
  [DESTINATION_FOLDER_ID]: CONNECTED_MAILBOX_ADDRESS,
  [FOREIGN_FOLDER_ID]: COLLEAGUE_ADDRESS,
};

const isOwnedByConnectedMailbox = (folderId: string): boolean =>
  FOLDER_OWNERS[folderId] === CONNECTED_MAILBOX_ADDRESS;

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

const makeMailboxEvent = (
  id: string,
  iCalUId: string,
  folderId: string,
  subject: string = MAPPED_SUBJECT,
): MailboxEvent => ({
  categories: [KEEPER_CATEGORY],
  end: { dateTime: "2026-09-01T16:00:00.0000000", timeZone: "UTC" },
  folderId,
  iCalUId,
  id,
  isAllDay: false,
  showAs: "busy",
  start: { dateTime: "2026-09-01T15:00:00.0000000", timeZone: "UTC" },
  subject,
});

interface GraphRequest {
  body: string | null;
  method: string;
  url: string;
}

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

const isMailboxOwnerRead = (url: URL): boolean => {
  const segments = readPathSegments(url);
  return segments.length === 1 && segments[0] === "me";
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

const readSelectedFields = (url: URL): string[] => {
  const select = url.searchParams.get("$select");
  if (!select) {
    return [];
  }
  return select.split(",").map((field) => field.trim()).filter((field) => field.length > 0);
};

/* Graph hands back exactly the fields the caller selected. A double that volunteers `owner` to a
   read that never asked for it would certify a filter the real mailbox cannot support. */
const projectCalendarEntry = (folderId: string, selected: string[]): Record<string, unknown> => {
  const entry: Record<string, unknown> = {};
  if (selected.length === 0 || selected.includes("id")) {
    entry["id"] = folderId;
  }
  if (selected.includes("owner")) {
    entry["owner"] = { address: FOLDER_OWNERS[folderId], name: FOLDER_OWNERS[folderId] };
  }
  return entry;
};

const readRequestBody = (init?: RequestInit): string | null => {
  if (typeof init?.body !== "string") {
    return null;
  }
  return init.body;
};

const readRequestedSubject = (body: string | null): string => {
  const parsed = JSON.parse(body ?? "{}") as { subject?: unknown };
  if (typeof parsed.subject !== "string") {
    return MAPPED_SUBJECT;
  }
  return parsed.subject;
};

/* A synthetic Graph mailbox with the real shape: /me addresses only the connected mailbox, so an
   item held in a colleague's shared calendar is unreachable through /me/events, and a folder-scoped
   listing only ever answers about the folder its URL names. */
const installGraphMailbox = (events: MailboxEvent[]): GraphRequest[] => {
  const requests: GraphRequest[] = [];
  const held = [...events];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const body = readRequestBody(init);
    requests.push({ body, method, url: url.toString() });

    const directId = readDirectEventId(url);
    const addressableDirectly = (event: MailboxEvent): boolean =>
      event.id === directId && isOwnedByConnectedMailbox(event.folderId);

    if (method === "DELETE") {
      const index = held.findIndex((event) => addressableDirectly(event));
      if (index === -1) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      held.splice(index, 1);
      return Promise.resolve(new Response(null, { status: 204 }));
    }

    if (method === "PATCH") {
      const target = held.find((event) => addressableDirectly(event));
      if (!target) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
      const parsed = JSON.parse(body ?? "{}") as { subject?: unknown };
      if (typeof parsed.subject === "string") {
        target.subject = parsed.subject;
      }
      return Promise.resolve(Response.json(target));
    }

    if (method === "POST") {
      const subject = readRequestedSubject(body);
      const created = makeMailboxEvent(
        "AAMkAGcreated",
        "created-uid",
        readAddressedFolderId(url),
        subject,
      );
      held.push(created);
      return Promise.resolve(Response.json(created));
    }

    if (isMailboxOwnerRead(url)) {
      return Promise.resolve(Response.json({
        id: "user-1",
        mail: CONNECTED_MAILBOX_ADDRESS,
        userPrincipalName: CONNECTED_MAILBOX_ADDRESS,
      }));
    }

    if (isCalendarListRead(url)) {
      const selected = readSelectedFields(url);
      return Promise.resolve(Response.json({
        value: [DESTINATION_FOLDER_ID, DEFAULT_FOLDER_ID, FOREIGN_FOLDER_ID]
          .map((folderId) => projectCalendarEntry(folderId, selected)),
      }));
    }

    if (directId) {
      const found = held.find((event) => addressableDirectly(event));
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

const createProvider = () =>
  createOutlookSyncProvider({
    accessToken: "test-token",
    refreshToken: "test-refresh",
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    externalCalendarId: DESTINATION_FOLDER_ID,
    calendarId: DESTINATION_CALENDAR_ID,
    userId: "user-1",
  });

const localEvent: MaterializedSyncableEvent = {
  calendarId: "source-cal-1",
  calendarName: "Work",
  calendarUrl: null,
  endTime: END_TIME,
  id: "sync-event-1",
  sourceEventUid: "source-uid-1",
  startTime: START_TIME,
  summary: EDITED_SUBJECT,
};

const mappedEvent: MaterializedSyncableEvent = { ...localEvent, summary: MAPPED_SUBJECT };

const mapping: EventMapping = {
  calendarId: DESTINATION_CALENDAR_ID,
  deleteIdentifier: MAPPED_ID,
  destinationEventUid: MIRROR_UID,
  endTime: END_TIME,
  eventStateId: "sync-event-1",
  id: MAPPING_ID,
  sourceCalendarId: "source-cal-1",
  startTime: START_TIME,
  syncEventHash: createSyncEventContentHash(mappedEvent),
  syncEventId: "sync-event-1",
};

const WINDOW = {
  timeMax: new Date("2100-01-01T00:00:00.000Z"),
  timeMin: new Date("2000-01-01T00:00:00.000Z"),
};

const TARGETED_READ_SCOPE = {
  authoritativeMappingIds: new Set([MAPPING_ID]),
  authoritativeWindow: WINDOW,
  requestedWindow: WINDOW,
};

const requestsOfMethod = (requests: GraphRequest[], method: string): GraphRequest[] =>
  requests.filter((request) => request.method === method);

const requestsTouchingForeignCalendar = (requests: GraphRequest[]): GraphRequest[] =>
  requests.filter((request) => request.url.includes(encodeURIComponent(FOREIGN_FOLDER_ID))
    || request.url.includes(FOREIGN_FOLDER_ID));

interface CycleOutcome {
  allUpdates: PendingUpdate[];
  requests: GraphRequest[];
}

const runCycle = async (
  mappings: EventMapping[],
  requests: GraphRequest[],
): Promise<CycleOutcome> => {
  const before = requests.length;
  const checkpointed: PendingChanges[] = [];
  const { operations } = computeSyncOperations(
    [localEvent],
    mappings,
    [],
    TARGETED_READ_SCOPE,
  );

  const outcome = await executeRemoteOperations(
    operations,
    mappings,
    DESTINATION_CALENDAR_ID,
    createProvider(),
    globalThis.undefined,
    globalThis.undefined,
    (changes: PendingChanges) => {
      checkpointed.push(changes);
      return Promise.resolve(true);
    },
  );

  const checkpointedUpdates = checkpointed.flatMap((changes) => changes.updates ?? []);
  return {
    allUpdates: [...(outcome.changes.updates ?? []), ...checkpointedUpdates],
    requests: requests.slice(before),
  };
};

describe("outlook absence is proven only against the connected mailbox's own calendars", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* The recipient deleted the mirror from the destination. The only remaining copy of the uid lives
     in a colleague's shared calendar, which /me/calendars hands back alongside the account's own. */
  it("calls the mirror absent when the only copy of the uid is in a foreign-owned calendar", async () => {
    installGraphMailbox([makeMailboxEvent(FOREIGN_COPY_ID, MIRROR_UID, FOREIGN_FOLDER_ID)]);

    const provider = createProvider();
    const { verifyEventsExist } = provider;
    if (!verifyEventsExist) {
      throw new TypeError("Expected the provider to expose verifyEventsExist");
    }

    const report = await verifyEventsExist([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ identifier: MAPPED_ID, status: "absent" });
  });

  it("issues no event listing against a calendar the account does not own", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(FOREIGN_COPY_ID, MIRROR_UID, FOREIGN_FOLDER_ID),
    ]);

    const provider = createProvider();
    const { verifyEventsExist } = provider;
    if (!verifyEventsExist) {
      throw new TypeError("Expected the provider to expose verifyEventsExist");
    }

    await verifyEventsExist([{ deleteId: MAPPED_ID, uid: MIRROR_UID }]);

    expect(requestsTouchingForeignCalendar(requests)).toEqual([]);
  });

  it("restores the deleted mirror and never writes the foreign item id onto the mapping", async () => {
    const requests = installGraphMailbox([
      makeMailboxEvent(FOREIGN_COPY_ID, MIRROR_UID, FOREIGN_FOLDER_ID),
    ]);

    const cycle = await runCycle([mapping], requests);

    const creates = requestsOfMethod(cycle.requests, "POST");
    expect(creates).toHaveLength(1);
    expect(creates[0]?.url).toContain(DESTINATION_FOLDER_ID);
    // The colleague's copy is not this sync's to touch.
    expect(requestsOfMethod(cycle.requests, "DELETE")).toEqual([]);
    expect(requestsTouchingForeignCalendar(cycle.requests)).toEqual([]);
    expect(
      cycle.allUpdates.filter((update) => update.deleteIdentifier === FOREIGN_COPY_ID),
    ).toEqual([]);
  });
});
